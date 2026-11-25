import { createHash, randomBytes } from 'node:crypto';
import { oneOf, optionalText, text, type Db } from './db.ts';
import { fail, ok, type Result } from './result.ts';

/** Where an address stands with the free newsletter. Only confirmed addresses are ever sent it. */
export const SUBSCRIBER_STATUSES = ['pending', 'confirmed', 'unsubscribed'] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

/** How long a confirmation link works. Long enough for a slow inbox, short enough that a forgotten one stops working. */
export const CONFIRM_DAYS = 7;
/** An address waiting to confirm gets at most one new link in this window, so the form cannot be used to flood an inbox. */
export const CONFIRM_RESEND_GAP_MS = 10 * 60_000;

/** A link to confirm an address. The token is shown once, in the letter. Only its hash is stored. */
export interface ConfirmLink {
  readonly email: string;
  readonly token: string;
  readonly expiresAt: string;
}

export type ConfirmRefusal = 'unknown' | 'expired';

/** A confirmed address, with the key that lets one click take it off the list. */
export interface Reader {
  readonly email: string;
  readonly key: string;
}

const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** The free newsletter's list: who asked for it, who confirmed, who left. Double opt-in, so nobody is on it without clicking. */
export function createNewsletter(db: Db, now: () => Date = () => new Date()) {
  return {
    /**
     * Asks for the newsletter at an address. A new or unsubscribed address becomes pending and gets a link; a pending
     * one gets a fresh link, unless it was sent one in the last few minutes; a confirmed one gets nothing. Null when no
     * letter should go. The caller answers every case the same way, so the form never says who is on the list.
     */
    subscribe(email: string, source: string): ConfirmLink | null {
      return db.transaction(() => {
        const at = now();
        const row = db.prepare('SELECT status, confirm_sent_at FROM subscribers WHERE email = ?').get(email);
        const status = row ? oneOf(row, 'status', SUBSCRIBER_STATUSES) : null;
        if (status === 'confirmed') return null;
        const sentAt = row ? optionalText(row, 'confirm_sent_at') : null;
        if (status === 'pending' && sentAt !== null && sentAt > iso(new Date(at.getTime() - CONFIRM_RESEND_GAP_MS))) return null;

        const token = randomBytes(32).toString('base64url');
        const expiresAt = iso(new Date(at.getTime() + CONFIRM_DAYS * DAY_MS));
        if (row) {
          db.prepare(
            `UPDATE subscribers SET status = 'pending', source = ?, token_hash = ?, token_expires_at = ?, confirm_sent_at = ?, confirmed_at = NULL, unsubscribed_at = NULL
             WHERE email = ?`,
          ).run(source, tokenHash(token), expiresAt, iso(at), email);
        } else {
          db.prepare(
            `INSERT INTO subscribers (email, status, source, token_hash, token_expires_at, confirm_sent_at, unsubscribe_key, created_at)
             VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)`,
          ).run(email, source, tokenHash(token), expiresAt, iso(at), randomBytes(16).toString('hex'), iso(at));
        }
        return { email, token, expiresAt };
      });
    },

    /**
     * Confirms the address a link was sent to. Confirming it again, from a second tab or a double press, still
     * succeeds: the link stays valid for a confirmed address until it unsubscribes.
     */
    confirm(token: string): Result<{ readonly email: string }, ConfirmRefusal> {
      return db.transaction(() => {
        const row = db.prepare('SELECT email, status, token_expires_at FROM subscribers WHERE token_hash = ?').get(tokenHash(token));
        if (!row) return fail('unknown');
        const email = text(row, 'email');
        if (oneOf(row, 'status', SUBSCRIBER_STATUSES) === 'confirmed') return ok({ email });
        if (text(row, 'token_expires_at') <= iso(now())) return fail('expired');
        db.prepare(`UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE token_hash = ?`).run(iso(now()), tokenHash(token));
        return ok({ email });
      });
    },

    /** Takes whoever holds the key off the list, and retires their confirmation link. True if the key was someone's. */
    unsubscribe(key: string): boolean {
      return (
        db
          .prepare(
            `UPDATE subscribers SET status = 'unsubscribed', token_hash = NULL, token_expires_at = NULL,
               unsubscribed_at = CASE WHEN status = 'unsubscribed' THEN unsubscribed_at ELSE ? END
             WHERE unsubscribe_key = ?`,
          )
          .run(iso(now()), key).changes > 0
      );
    },

    /** Everyone the newsletter goes to: confirmed addresses only, oldest first. */
    readers(): Reader[] {
      return db
        .prepare(`SELECT email, unsubscribe_key FROM subscribers WHERE status = 'confirmed' ORDER BY id`)
        .all()
        .map((row) => ({ email: text(row, 'email'), key: text(row, 'unsubscribe_key') }));
    },
  };
}
