import { STATUS_SQL } from './club.ts';
import { integer, text, type Db, type Row } from './db.ts';

/** Someone an email goes to. */
export interface Recipient {
  readonly email: string;
  readonly name: string;
}

/** Which club emails a member wants. Invitations, resets and session emails they asked for always go. */
export interface EmailPrefs {
  readonly replies: boolean;
  readonly digest: boolean;
}

/** A member hears about a thread at most this often, however busy it gets. */
export const REPLY_NOTICE_GAP_MS = 6 * 3_600_000;

const MALAYSIA_MS = 8 * 3_600_000;

/** The week a digest is due for: that Monday's date in Malaysia, from 8 am on. Null on any other day or hour. */
export function digestWeek(at: Date): string | null {
  const local = new Date(at.getTime() + MALAYSIA_MS);
  return local.getUTCDay() === 1 && local.getUTCHours() >= 8 ? local.toISOString().slice(0, 10) : null;
}

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const toRecipient = (row: Row): Recipient => ({ email: text(row, 'email'), name: text(row, 'name') });

/** Who gets which optional email, and the records that keep each from going twice. */
export function createMailings(db: Db, now: () => Date = () => new Date()) {
  return {
    prefs(memberId: number): EmailPrefs {
      const row = db.prepare('SELECT email_replies, email_digest FROM members WHERE id = ?').get(memberId);
      return { replies: row ? integer(row, 'email_replies') === 1 : false, digest: row ? integer(row, 'email_digest') === 1 : false };
    },

    setPrefs(memberId: number, prefs: EmailPrefs): void {
      db.prepare('UPDATE members SET email_replies = ?, email_digest = ? WHERE id = ?').run(prefs.replies ? 1 : 0, prefs.digest ? 1 : 0, memberId);
    },

    /**
     * The members to tell about a new reply: everyone who has posted in the thread, its starter included, except the
     * one replying. Only active members who want these emails, and none told about this thread in the last six hours.
     * The ones returned are recorded as told.
     */
    replyNotices(threadId: number, replierId: number): { readonly title: string; readonly recipients: readonly Recipient[] } {
      return db.transaction(() => {
        const thread = db.prepare('SELECT title FROM threads WHERE id = ? AND removed_at IS NULL').get(threadId);
        if (!thread) return { title: '', recipients: [] };
        const at = now();
        const recipients = db
          .prepare(
            `SELECT DISTINCT m.id, m.email, m.name FROM posts p JOIN members m ON m.id = p.author_id
             WHERE p.thread_id = ? AND m.id != ? AND m.email_replies = 1 AND ${STATUS_SQL.active}
               AND NOT EXISTS (SELECT 1 FROM reply_notices n WHERE n.member_id = m.id AND n.thread_id = ? AND n.sent_at > ?)`,
          )
          .all(threadId, replierId, threadId, iso(new Date(at.getTime() - REPLY_NOTICE_GAP_MS)));
        const record = db.prepare(
          `INSERT INTO reply_notices (member_id, thread_id, sent_at) VALUES (?, ?, ?)
           ON CONFLICT (member_id, thread_id) DO UPDATE SET sent_at = excluded.sent_at`,
        );
        for (const row of recipients) record.run(integer(row, 'id'), threadId, iso(at));
        return { title: text(thread, 'title'), recipients: recipients.map(toRecipient) };
      });
    },

    digestRecipients(): Recipient[] {
      return db.prepare(`SELECT email, name FROM members WHERE email_digest = 1 AND ${STATUS_SQL.active} ORDER BY id`).all().map(toRecipient);
    },

    /** Claims a week's digest. True the first time for that week only, so a retried job never sends it twice. */
    claimDigest(week: string): boolean {
      return db.prepare('INSERT INTO digests (week, sent_at) VALUES (?, ?) ON CONFLICT (week) DO NOTHING').run(week, iso(now())).changes === 1;
    },
  };
}
