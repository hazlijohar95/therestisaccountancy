import { RATING_IDS, RENEWAL_REMINDER_DAYS, type Rating } from '../data/social.ts';
import { integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import { daysLeft } from './social-claims.ts';
import { NOTICE_KINDS } from './social-notify.ts';
import { activeSql, authorOf, type Author } from './social-profiles.ts';

/*
 * Reading notifications. Rows keep ids, and each is read against what is true now: a notification whose actor has
 * gone, or whose post was removed, is left out, and a co-sign request or a renewal says whether it still needs you.
 */

interface Seen {
  readonly id: number;
  readonly createdAt: string;
  readonly unread: boolean;
}

export type Notice = Seen &
  (
    | { readonly kind: 'reply' | 'accepted'; readonly actor: Author; readonly postId: number; readonly title: string }
    | { readonly kind: 'useful'; readonly actor: Author; readonly postId: number; readonly title: string; readonly target: 'post' | 'reply' }
    | { readonly kind: 'follow'; readonly actor: Author }
    | { readonly kind: 'rating'; readonly actor: Author; readonly number: number; readonly rating: Rating }
    /** live: still waiting on this member to co-sign. */
    | { readonly kind: 'cosign-request'; readonly actor: Author; readonly entryId: number; readonly live: boolean; readonly decision: 'signed' | 'declined' | null }
    | { readonly kind: 'cosign-outcome'; readonly actor: Author; readonly outcome: 'signed' | 'declined' }
    | { readonly kind: 'ticked' | 'not-ticked'; readonly label: string }
    /** live: still ticked and inside the renewal window. */
    | { readonly kind: 'renewal'; readonly label: string; readonly until: string; readonly live: boolean }
    | { readonly kind: 'nominee-joined'; readonly account: string }
  );

const OUTCOMES = ['signed', 'declined'] as const;
const LIST_LIMIT = 50;
const RENEWAL_WINDOW_DAYS = RENEWAL_REMINDER_DAYS[0];

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function createSocialNotifications(db: Db, now: () => Date = () => new Date()) {
  const actorOf = (row: Row): Author | null => {
    const actorId = row.actor_id === null ? null : integer(row, 'actor_id');
    if (actorId === null) return null;
    const visible = db.prepare(`SELECT 1 FROM profiles p WHERE p.member_id = ? AND ${activeSql('p.member_id')}`).get(actorId);
    return visible ? authorOf(db, actorId) : null;
  };

  const subject = (row: Row) => integer(row, 'subject_id');
  const livePost = (postId: number) => db.prepare('SELECT title FROM floor_posts WHERE id = ? AND removed_at IS NULL').get(postId);

  /** The notification as it reads now, or null when what it is about has gone. */
  const resolve = (row: Row): Notice | null => {
    const seen: Seen = { id: integer(row, 'id'), createdAt: text(row, 'created_at'), unread: optionalText(row, 'read_at') === null };
    const kind = oneOf(row, 'kind', NOTICE_KINDS);
    const detail = text(row, 'detail');
    switch (kind) {
      case 'reply':
      case 'accepted':
      case 'useful': {
        const actor = actorOf(row);
        const post = livePost(subject(row));
        if (!actor || !post) return null;
        const about = { actor, postId: subject(row), title: text(post, 'title') };
        return kind === 'useful' ? { ...seen, kind, ...about, target: detail === 'reply' ? 'reply' : 'post' } : { ...seen, kind, ...about };
      }
      case 'follow': {
        const actor = actorOf(row);
        return actor ? { ...seen, kind, actor } : null;
      }
      case 'rating': {
        const actor = actorOf(row);
        return actor ? { ...seen, kind, actor, number: subject(row), rating: oneOf(row, 'detail', RATING_IDS) } : null;
      }
      case 'cosign-request': {
        const actor = actorOf(row);
        const entry = db.prepare('SELECT cosign FROM casebook WHERE id = ? AND cosigner_id = ?').get(subject(row), integer(row, 'member_id'));
        if (!actor || !entry) return null;
        const state = optionalText(entry, 'cosign');
        const decision = OUTCOMES.find((outcome) => outcome === state) ?? null;
        return { ...seen, kind, actor, entryId: subject(row), live: state === 'pending', decision };
      }
      case 'cosign-outcome': {
        const actor = actorOf(row);
        return actor ? { ...seen, kind, actor, outcome: oneOf(row, 'detail', OUTCOMES) } : null;
      }
      case 'ticked':
      case 'not-ticked':
        return { ...seen, kind, label: detail };
      case 'renewal': {
        const claim = db.prepare('SELECT label, until, state FROM claims WHERE id = ? AND member_id = ?').get(subject(row), integer(row, 'member_id'));
        const until = claim ? optionalText(claim, 'until') : null;
        if (!claim || until === null) return null;
        const left = daysLeft(until, now());
        return { ...seen, kind, label: text(claim, 'label'), until, live: text(claim, 'state') === 'ticked' && left > 0 && left <= RENEWAL_WINDOW_DAYS };
      }
      case 'nominee-joined':
        return { ...seen, kind, account: detail };
    }
  };

  const rows = (memberId: number, where: string, limit: number) =>
    db.prepare(`SELECT * FROM notifications WHERE member_id = ? ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).all(memberId, limit);

  return {
    /** The latest notifications, newest first, as they read now. */
    list(memberId: number): Notice[] {
      return rows(memberId, '', LIST_LIMIT).flatMap((row) => resolve(row) ?? []);
    },

    /** Unread notifications that still read as something. The bell shows this. */
    unread(memberId: number): number {
      return rows(memberId, 'AND read_at IS NULL', LIST_LIMIT).filter((row) => resolve(row) !== null).length;
    },

    /** Everything up to now has been seen. */
    markRead(memberId: number): void {
      db.prepare('UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL').run(iso(now()), memberId);
    },
  };
}

export type SocialNotifications = ReturnType<typeof createSocialNotifications>;
