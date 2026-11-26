import type { Db } from './db.ts';

/*
 * Writing a notification, inside whatever write it is about, so the two land together or not at all. Kept apart from
 * the module that reads them, which needs profiles, so every module can write one without importing in a circle.
 */

/**
 * Each kind of notification, and what its columns hold. actor_id is the member who did it (none for the team's
 * decisions and reminders); subject_id and detail say what it is about.
 */
export const NOTICE_KINDS = [
  /** subject: the post. */
  'reply',
  /** subject: the post. */
  'accepted',
  /** subject: the post. detail: 'post' or 'reply', what was marked. */
  'useful',
  'follow',
  /** subject: the problem's number. detail: the rating. */
  'rating',
  /** subject: the casebook entry. */
  'cosign-request',
  /** subject: the casebook entry. detail: 'signed' or 'declined'. */
  'cosign-outcome',
  /** detail: the claim or account, as the member's ledger names it. */
  'ticked',
  /** detail: the claim or account. */
  'not-ticked',
  /** subject: the claim. */
  'renewal',
  /** detail: the account, as "LinkedIn · @handle". */
  'nominee-joined',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface NewNotice {
  readonly kind: NoticeKind;
  /**
   * What makes it one notification: the same key for the same member is written once, so toggling a mark or a follow
   * does not notify twice. A changed rating updates its detail and keeps whether it was read.
   */
  readonly key: string;
  readonly actorId?: number | null;
  readonly subjectId?: number | null;
  readonly detail?: string;
}

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Notifies a member, never about their own doing. Writing the same key again changes only its detail. */
export function notify(db: Db, at: Date, memberId: number, notice: NewNotice): void {
  if (notice.actorId === memberId) return;
  db.prepare(
    `INSERT INTO notifications (member_id, kind, key, actor_id, subject_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (member_id, key) DO UPDATE SET detail = excluded.detail`,
  ).run(memberId, notice.kind, `${notice.kind}:${notice.key}`, notice.actorId ?? null, notice.subjectId ?? null, notice.detail ?? '', iso(at));
}

/** Takes a notification back, when what it said is no longer true: a rating withdrawn. */
export function unnotify(db: Db, memberId: number, kind: NoticeKind, key: string): void {
  db.prepare('DELETE FROM notifications WHERE member_id = ? AND key = ?').run(memberId, `${kind}:${key}`);
}
