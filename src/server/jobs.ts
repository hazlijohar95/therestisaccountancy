import { channelBySlug, threadPath } from '../data/community.ts';
import { openStore } from './instance.ts';
import { GRACE_MS } from './billing.ts';
import { callLetters } from './calls.ts';
import { summaryDue } from './incidents.ts';
import { digestLetter, incidentsLetter, paymentDueLetter, renewalLetter, sessionLetters, type Letter } from './letters.ts';
import { send } from './mail.ts';
import { digestWeek } from './mailings.ts';
import { renew } from './payments.ts';
import { report } from './report.ts';

const WEEK_MS = 7 * 86_400_000;
/** Letters go a few at a time, so a long list never trips the sending limits all at once. */
const SENDING_AT_ONCE = 5;

/** Runs every hour: renewals that are due, reminders to pay by hand, reminders for sessions and one-to-one calls within a day, and on Monday mornings the week's digest. Safe to rerun. */
export async function hourly(at: Date, siteUrl: string): Promise<void> {
  const url = (path: string) => new URL(path, siteUrl).href;
  const store = await openStore();
  const letters: Letter[] = [];
  let summary: { readonly letter: Letter; readonly lastId: number } | null = null;
  try {
    for (const renewal of await store.billing.dueRenewals()) {
      const outcome = await renew(store.billing, renewal, siteUrl).catch(async (error: unknown) => {
        await report('renewal', `Renewal for ${renewal.email} could not be charged; it is retried tomorrow`, error);
        return 'error' as const;
      });
      if (outcome === 'declined' || outcome === 'card-refused') {
        await report('renewal', `Renewal for ${renewal.email} was ${outcome === 'declined' ? 'declined' : 'refused: the saved card no longer works'}`);
        const accessUntil = new Date(new Date(renewal.paidUntil).getTime() + GRACE_MS).toISOString();
        letters.push(renewalLetter(renewal, { term: renewal.term, cardRefused: outcome === 'card-refused', accessUntil, payUrl: url('/members/pay') }));
      }
    }
    for (const due of await store.billing.paymentReminders()) letters.push(paymentDueLetter(due, { term: due.term, paidUntil: due.paidUntil, payUrl: url('/members/pay') }));
    for (const { session, attendees } of await store.schedule.dueReminders()) letters.push(...sessionLetters('reminder', session, attendees, siteUrl));
    for (const call of await store.calls.dueReminders()) letters.push(...callLetters('reminder', call, siteUrl));

    const week = digestWeek(at);
    if (week && (await store.mailings.claimDigest(week))) {
      const board = await store.community.since(new Date(at.getTime() - WEEK_MS));
      const sessions = (await store.schedule.upcoming(null)).filter((s) => new Date(s.startsAt).getTime() < at.getTime() + WEEK_MS);
      if (board.threads.length || board.replies || sessions.length) {
        const news = {
          threads: board.threads.map((t) => ({ title: t.title, channel: channelBySlug(t.channel)?.name ?? t.channel, replies: t.replies, url: url(threadPath(t.id)) })),
          replies: board.replies,
          sessions: sessions.map((s) => ({ title: s.title, startsAt: s.startsAt })),
          communityUrl: url('/members/community'),
          sessionsUrl: url('/members/sessions'),
          settingsUrl: url('/members/account#email'),
        };
        for (const to of await store.mailings.digestRecipients()) letters.push(digestLetter(to, news));
      }
    }

    if (summaryDue(at)) {
      const { incidents, lastId } = await store.incidents.unreported();
      const admins = await store.club.adminEmails();
      if (incidents.length && admins.length) summary = { letter: incidentsLetter(admins, incidents, url('/admin')), lastId };
    }
  } catch (error) {
    await report('job', 'The hourly job stopped part way; the rest runs next hour', error);
  } finally {
    store[Symbol.dispose]();
  }

  let sent = 0;
  for (let i = 0; i < letters.length; i += SENDING_AT_ONCE) {
    sent += (await Promise.all(letters.slice(i, i + SENDING_AT_ONCE).map(send))).filter(Boolean).length;
  }
  if (letters.length) console.log(`Hourly job sent ${sent} of ${letters.length} emails`);
  /* The summary is marked sent only once it has gone; if it fails, its failures wait for tomorrow's. */
  if (summary && (await send(summary.letter))) {
    const after = await openStore();
    try {
      await after.incidents.reported(summary.lastId);
    } finally {
      after[Symbol.dispose]();
    }
  }
}
