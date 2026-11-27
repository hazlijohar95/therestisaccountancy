import { createBilling } from './billing.ts';
import { STATUS_SQL } from './club.ts';
import { integer, optionalText, text, type Db, type Row } from './db.ts';

/** Someone an email goes to. */
export interface Recipient {
  readonly email: string;
  readonly name: string;
}

/** A recipient of an optional email, with the key that lets one click stop it. */
export interface Subscriber extends Recipient {
  readonly key: string;
}

/** The optional emails, each of which one click can stop. */
export const LISTS = ['replies', 'digest', 'onboarding'] as const;
export type List = (typeof LISTS)[number];

/** Which club emails a member wants. Invitations, resets and session emails they asked for always go. */
export interface EmailPrefs {
  readonly replies: boolean;
  readonly digest: boolean;
}

/** The lists a member can also turn on and off on their account page. The rest only stop. */
export const inSettings = (list: List): list is keyof EmailPrefs => list === 'replies' || list === 'digest';

/** A member hears about replies to a post at most this often, however busy it gets. */
export const REPLY_NOTICE_GAP_MS = 6 * 3_600_000;

const MALAYSIA_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * The getting-started emails: the day after a member first pays that each is due. They lead to one thing, a first
 * live session, and stop once the member says they are coming to one.
 */
export const ONBOARDING_DAYS = [1, 4, 9] as const;
/** An index into ONBOARDING_DAYS, so a new day fails to compile until its email is written. */
export type OnboardingStep = Exclude<Partial<typeof ONBOARDING_DAYS>['length'], (typeof ONBOARDING_DAYS)['length']>;
const isStep = (n: number): n is OnboardingStep => Number.isInteger(n) && n >= 0 && n < ONBOARDING_DAYS.length;
/** Two emails never go closer together than this, even when one was held back for want of a session to name. */
const ONBOARDING_GAP_MS = 2 * DAY_MS;
/** Past this, a member who has still not booked is left alone: the sequence has had its chance. */
const ONBOARDING_WINDOW_MS = 21 * DAY_MS;

/** The step due now for a member who first paid at `from` and has had `sent` of the emails, or null if none is. */
export function onboardingStep(from: Date, sent: number, lastAt: Date | null, now: Date): OnboardingStep | null {
  if (!isStep(sent)) return null;
  const t = now.getTime();
  if (t > from.getTime() + ONBOARDING_WINDOW_MS) return null;
  if (t < from.getTime() + ONBOARDING_DAYS[sent] * DAY_MS) return null;
  if (lastAt && t < lastAt.getTime() + ONBOARDING_GAP_MS) return null;
  return sent;
}

/** The week a digest is due for: that Monday's date in Malaysia, from 8 am on. Null on any other day or hour. */
export function digestWeek(at: Date): string | null {
  const local = new Date(at.getTime() + MALAYSIA_MS);
  return local.getUTCDay() === 1 && local.getUTCHours() >= 8 ? local.toISOString().slice(0, 10) : null;
}

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const toRecipient = (row: Row): Recipient => ({ email: text(row, 'email'), name: text(row, 'name') });
const toSubscriber = (row: Row): Subscriber => ({ ...toRecipient(row), key: text(row, 'unsubscribe_key') });
const COLUMN: Record<List, string> = { replies: 'email_replies', digest: 'digest_opt_in', onboarding: 'email_onboarding' };

/** Members created since the keys were added get one before they are emailed. */
const keyed = (db: Db) => db.exec('UPDATE members SET unsubscribe_key = lower(hex(randomblob(16))) WHERE unsubscribe_key IS NULL');

/**
 * Inside a transaction: the members to tell about a new reply to a Floor post: its author and everyone who replied
 * before, except the one replying. Only active members who want these emails, who can still open the post (opens says,
 * by the Floor's rule), and who were not told about this post in the last six hours. The ones returned are recorded as
 * told.
 */
export function noticeReply(db: Db, at: Date, postId: number, replierId: number, opens: (memberId: number) => boolean): Subscriber[] {
  keyed(db);
  const recipients = db
    .prepare(
      `SELECT m.id, m.email, m.name, m.unsubscribe_key FROM members m
       WHERE m.id != ? AND m.email_replies = 1 AND ${STATUS_SQL.active}
         AND (m.id = (SELECT member_id FROM floor_posts WHERE id = ?)
           OR EXISTS (SELECT 1 FROM floor_replies r WHERE r.post_id = ? AND r.member_id = m.id AND r.removed_at IS NULL))
         AND NOT EXISTS (SELECT 1 FROM floor_reply_notices n WHERE n.member_id = m.id AND n.post_id = ? AND n.sent_at > ?)
       ORDER BY m.id`,
    )
    .all(replierId, postId, postId, postId, iso(new Date(at.getTime() - REPLY_NOTICE_GAP_MS)))
    .filter((row) => opens(integer(row, 'id')));
  const record = db.prepare(
    `INSERT INTO floor_reply_notices (member_id, post_id, sent_at) VALUES (?, ?, ?)
     ON CONFLICT (member_id, post_id) DO UPDATE SET sent_at = excluded.sent_at`,
  );
  for (const row of recipients) record.run(integer(row, 'id'), postId, iso(at));
  return recipients.map(toSubscriber);
}

/** Inside a transaction or not: the members owed a getting-started email at `at`, and the step each is owed. Changes nothing. */
function owedOnboarding(db: Db, at: Date): { readonly row: Row; readonly step: OnboardingStep }[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.email, m.name, m.unsubscribe_key, m.onboarding_sent, m.onboarding_last_at,
         (SELECT min(p.paid_at) FROM payments p WHERE p.member_id = m.id AND p.status = 'paid' AND p.reversed_at IS NULL) AS first_paid_at
       FROM members m JOIN subscriptions s ON s.member_id = m.id
       WHERE m.role = 'member' AND ${STATUS_SQL.active} AND m.email_onboarding = 1 AND m.onboarding_sent < ? AND s.paid_until > ?
         AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.member_id = m.id)`,
    )
    .all(ONBOARDING_DAYS.length, iso(at));
  return rows.flatMap((row) => {
    const firstPaid = optionalText(row, 'first_paid_at');
    if (firstPaid === null) return [];
    const lastAt = optionalText(row, 'onboarding_last_at');
    const step = onboardingStep(new Date(firstPaid), integer(row, 'onboarding_sent'), lastAt === null ? null : new Date(lastAt), at);
    return step === null ? [] : [{ row, step }];
  });
}

/** Who gets which optional email, and the records that keep each from going twice. */
export function createMailings(db: Db, now: () => Date = () => new Date()) {
  const billing = createBilling(db, now);

  return {
    prefs(memberId: number): EmailPrefs {
      const row = db.prepare('SELECT email_replies, digest_opt_in FROM members WHERE id = ?').get(memberId);
      return { replies: row ? integer(row, 'email_replies') === 1 : false, digest: row ? integer(row, 'digest_opt_in') === 1 : false };
    },

    setPrefs(memberId: number, prefs: EmailPrefs): void {
      db.prepare('UPDATE members SET email_replies = ?, digest_opt_in = ? WHERE id = ?').run(prefs.replies ? 1 : 0, prefs.digest ? 1 : 0, memberId);
    },

    /**
     * Active members who asked for the weekly email and may open the members' room: paid, in grace, or the team. It is
     * opt-in: a roundup is not something they did.
     */
    digestRecipients(): Subscriber[] {
      return db.transaction(() => {
        keyed(db);
        return db
          .prepare(`SELECT id, email, name, unsubscribe_key FROM members WHERE digest_opt_in = 1 AND ${STATUS_SQL.active} ORDER BY id`)
          .all()
          .filter((row) => billing.club(integer(row, 'id')))
          .map(toSubscriber);
      });
    },

    /** Stops one optional email for whoever holds the key. True if the key was someone's. */
    unsubscribe(key: string, list: List): boolean {
      return db.prepare(`UPDATE members SET ${COLUMN[list]} = 0 WHERE unsubscribe_key = ?`).run(key).changes > 0;
    },

    /**
     * Members owed a getting-started email now, each marked as sent so a rerun finds none. Only paying members who have
     * not said they are coming to any session, and who have not stopped these emails. The clock starts at the first
     * payment, because a member cannot book a session before paying.
     */
    dueOnboarding(): (Subscriber & { readonly memberId: number; readonly step: OnboardingStep })[] {
      return db.transaction(() => {
        keyed(db);
        const at = now();
        const mark = db.prepare('UPDATE members SET onboarding_sent = onboarding_sent + 1, onboarding_last_at = ? WHERE id = ?');
        return owedOnboarding(db, at).map(({ row, step }) => {
          mark.run(iso(at), integer(row, 'id'));
          return { ...toSubscriber(row), memberId: integer(row, 'id'), step };
        });
      });
    },

    /** How many members are owed a getting-started email now, without sending or marking any. */
    onboardingWaiting(): number {
      return owedOnboarding(db, now()).length;
    },

    /** Hands back a getting-started email that did not send, so the next hourly run tries it again. */
    releaseOnboarding(memberId: number, step: OnboardingStep): void {
      db.prepare('UPDATE members SET onboarding_sent = ?, onboarding_last_at = NULL WHERE id = ? AND onboarding_sent = ?').run(step, memberId, step + 1);
    },

    /** Claims a week's digest. True the first time for that week only, so a retried job never sends it twice. */
    claimDigest(week: string): boolean {
      return db.prepare('INSERT INTO digests (week, sent_at) VALUES (?, ?) ON CONFLICT (week) DO NOTHING').run(week, iso(now())).changes === 1;
    },
  };
}
