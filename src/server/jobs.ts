import { channelBySlug, threadPath } from '../data/community.ts';
import { openStore } from './instance.ts';
import { GRACE_MS } from './billing.ts';
import { callLetters } from './calls.ts';
import { summaryDue } from './incidents.ts';
import { digestLetter, incidentsLetter, onboardingLetter, paymentDueLetter, renewalLetter, renewalNoticeLetter, sessionLetters, type Letter } from './letters.ts';
import { deleteEvidence } from './evidence.ts';
import { send } from './mail.ts';
import { digestWeek, type OnboardingStep } from './mailings.ts';
import { renew } from './payments.ts';
import { report } from './report.ts';
import { socialUrl } from './paths.ts';
import { REMINDER_LEAD_MS } from './schedule.ts';
import { tickRenewalLetter } from './social-letters.ts';

const WEEK_MS = 7 * 86_400_000;
/** Getting-started emails name sessions this far ahead, and at most this many. */
const ONBOARDING_HORIZON_MS = 2 * WEEK_MS;
const ONBOARDING_SESSIONS = 3;
/** Letters go a few at a time, so a long list never trips the sending limits all at once. */
const SENDING_AT_ONCE = 5;

/**
 * Runs every hour: renewals that are due, reminders to pay by hand, reminders for sessions and one-to-one calls within a
 * day, ticks that lapse or are due for renewal, documents left from decided claims, and on Monday mornings the week's
 * digest. Safe to rerun.
 */
export async function hourly(at: Date, siteUrl: string): Promise<void> {
  const url = (path: string) => new URL(path, siteUrl).href;
  const store = await openStore();
  const letters: Letter[] = [];
  /* Getting-started emails are claimed before sending; one that fails is handed back, since nothing about it is urgent. */
  const onboarding = new Map<Letter, { readonly memberId: number; readonly step: OnboardingStep }>();
  let summary: { readonly letter: Letter; readonly lastId: number } | null = null;
  /* Each source runs on its own, so one failing query never holds back the emails after it. */
  const step = (name: string, run: () => Promise<void>) =>
    run().catch((error: unknown) => report('job', `The hourly job's ${name} step failed; it runs again next hour`, error));
  try {
    await step('renewals', async () => {
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
    });
    await step('renewal notices', async () => {
      for (const notice of await store.billing.renewalNotices()) letters.push(renewalNoticeLetter(notice, { term: notice.term, chargesAt: notice.chargesAt, accountUrl: url('/members/account') }));
    });
    await step('payment reminders', async () => {
      for (const due of await store.billing.paymentReminders()) letters.push(paymentDueLetter(due, { term: due.term, paidUntil: due.paidUntil, payUrl: url('/members/pay') }));
    });
    await step('session reminders', async () => {
      for (const { session, attendees } of await store.schedule.dueReminders()) letters.push(...sessionLetters('reminder', session, attendees, siteUrl));
    });
    await step('call reminders', async () => {
      for (const call of await store.calls.dueReminders()) letters.push(...callLetters('reminder', call, siteUrl));
    });
    await step('ticks', async () => {
      await store.socialClaims.lapse();
      for (const renewal of await store.socialClaims.dueRenewals()) letters.push(tickRenewalLetter(renewal, socialUrl(siteUrl, '/verify')));
    });
    /* A document the review could not delete straight away (R2 was down) is tried again here, until it goes. */
    await step('evidence', async () => {
      for (const { claimId, key } of await store.socialClaims.staleEvidence()) {
        await deleteEvidence(key);
        await store.socialClaims.evidenceDeleted(claimId);
      }
    });
    /*
     * With no session to name, the emails wait rather than go: an invitation to nothing is worse than none. Sessions
     * inside the reminder window are left out, because their reminder has gone and the email promises one.
     */
    await step('getting-started emails', async () => {
      const startsIn = (s: { startsAt: string }) => new Date(s.startsAt).getTime() - at.getTime();
      const sessions = (await store.schedule.upcoming(null))
        .filter((s) => startsIn(s) > REMINDER_LEAD_MS && startsIn(s) < ONBOARDING_HORIZON_MS)
        .slice(0, ONBOARDING_SESSIONS);
      if (!sessions.length) return;
      const news = { sessions: sessions.map((s) => ({ title: s.title, startsAt: s.startsAt })), sessionsUrl: url('/members/sessions'), settingsUrl: url('/members/account#email') };
      for (const to of await store.mailings.dueOnboarding()) {
        const letter = onboardingLetter(to, to.step, news);
        onboarding.set(letter, { memberId: to.memberId, step: to.step });
        letters.push(letter);
      }
    });

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

  const failed: Letter[] = [];
  for (let i = 0; i < letters.length; i += SENDING_AT_ONCE) {
    const batch = letters.slice(i, i + SENDING_AT_ONCE);
    const results = await Promise.all(batch.map(send));
    batch.forEach((letter, k) => results[k] || failed.push(letter));
  }
  if (letters.length) console.log(`Hourly job sent ${letters.length - failed.length} of ${letters.length} emails`);
  const unsent = failed.flatMap((letter) => onboarding.get(letter) ?? []);
  if (unsent.length) {
    const after = await openStore();
    try {
      for (const { memberId, step } of unsent) await after.mailings.releaseOnboarding(memberId, step);
    } finally {
      after[Symbol.dispose]();
    }
  }
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
