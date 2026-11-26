import { createHash, randomBytes } from 'node:crypto';
import type { SessionKey } from './club.ts';
import { integer, type Db } from './db.ts';

/*
 * Sign-ins: the session behind each signed-in browser. The cookie holds a random token; only its hash is kept. A session carries the member's epoch when
 * it opened, so a password change or a suspension, which move the epoch on, ends every older session.
 */

/** How long a session lasts without signing in again. */
export const SESSION_DAYS = 30;

const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSignIns(db: Db, now: () => Date = () => new Date()) {
  return {
    /** Opens a session for the key a sign-in returned. The token goes in the cookie and is never stored. */
    open(key: SessionKey): { readonly token: string; readonly expiresAt: string } {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = iso(new Date(now().getTime() + SESSION_DAYS * DAY_MS));
      db.prepare('INSERT INTO sign_ins (token_hash, member_id, epoch, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(tokenHash(token), key.memberId, key.epoch, iso(now()), expiresAt);
      return { token, expiresAt };
    },

    /** The key a live session holds, for the club to check against the member. Null when unknown or expired. */
    key(token: string): SessionKey | null {
      const row = db.prepare('SELECT member_id, epoch FROM sign_ins WHERE token_hash = ? AND expires_at > ?').get(tokenHash(token), iso(now()));
      return row ? { memberId: integer(row, 'member_id'), epoch: integer(row, 'epoch') } : null;
    },

    /** Ends the session. Safe to call twice. */
    close(token: string): void {
      db.prepare('DELETE FROM sign_ins WHERE token_hash = ?').run(tokenHash(token));
    },

    /** Deletes expired sessions. Returns how many went. */
    prune(): number {
      return db.prepare('DELETE FROM sign_ins WHERE expires_at <= ?').run(iso(now())).changes;
    },
  };
}

export type SignIns = ReturnType<typeof createSignIns>;
