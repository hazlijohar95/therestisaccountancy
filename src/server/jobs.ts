import { channelBySlug, threadPath } from '../data/community.ts';
import { openStore } from './instance.ts';
import { GRACE_MS } from './billing.ts';
import { monthlyRate } from '../data/membership.ts';
import { digestLetter, paymentDueLetter, renewalLetter, sessionLetters, type Letter } from './letters.ts';
import { send } from './mail.ts';
import { digestWeek } from './mailings.ts';
import { renew } from './payments.ts';

const WEEK_MS = 7 * 86_400_000;
/** Letters go a few at a time, so a long list never trips the sending limits all at once. */
const SENDING_AT_ONCE = 5;

/** Runs every hour: renewals that are due, reminders to pay by hand, reminders for sessions within a day, and on Monday mornings the week's digest. Safe to rerun. */
export async function hourly(at: Date, siteUrl: string): Promise<void> {
  const url = (path: string) => new URL(path, siteUrl).href;
  const store = await openStore();
  const letters: Letter[] = [];
  try {
    for (const renewal of await store.billing.dueRenewals()) {
      const outcome = await renew(store.billing, renewal, siteUrl).catch((error: unknown) => {
        console.error('Renewal could not be charged', renewal.memberId, error);
        return 'error' as const;
      });
      if (outcome === 'declined' || outcome === 'card-refused') {
        const accessUntil = new Date(new Date(renewal.paidUntil).getTime() + GRACE_MS).toISOString();
        letters.push(renewalLetter(renewal, { cardRefused: outcome === 'card-refused', accessUntil, payUrl: url('/members/pay') }));
      }
    }
    for (const due of await store.billing.paymentReminders()) letters.push(paymentDueLetter(due, { paidUntil: due.paidUntil, rate: monthlyRate, payUrl: url('/members/pay') }));
    for (const { session, attendees } of await store.schedule.dueReminders()) letters.push(...sessionLetters('reminder', session, attendees, siteUrl));

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
  } finally {
    store[Symbol.dispose]();
  }

  let sent = 0;
  for (let i = 0; i < letters.length; i += SENDING_AT_ONCE) {
    sent += (await Promise.all(letters.slice(i, i + SENDING_AT_ONCE).map(send))).filter(Boolean).length;
  }
  if (letters.length) console.log(`Hourly job sent ${sent} of ${letters.length} emails`);
}
