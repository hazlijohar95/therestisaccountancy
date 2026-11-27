import { STATUS_SQL } from './club.ts';
import { createBilling, type RenewalStop } from './billing.ts';
import { integer, oneOf, optionalText, text, type Db } from './db.ts';

/** The things a member does that use what they pay for. */
export const ACTIVITY_KINDS = ['session', 'post', 'lesson', 'call', 'plan'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface LastActivity {
  readonly kind: ActivityKind;
  readonly at: string;
}

/** A paying member with nothing to show for it lately. */
export interface QuietMember {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly paidUntil: string;
  readonly renews: boolean;
  /** When renewal is off, the last time they turned it off. */
  readonly stop: RenewalStop | null;
  /** Null: nothing yet. */
  readonly last: LastActivity | null;
}

/** A member is quiet once this long has passed since they last did something, or since they first paid. */
export const QUIET_DAYS = 30;

const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Every dated thing a member did, from rows that already exist. Posts and replies share a term: SQLite on Workers allows five per compound SELECT. */
const EVENTS = `
  SELECT member_id, 'session' AS kind, created_at AS at FROM rsvps
  UNION ALL SELECT member_id, 'post', created_at FROM (
    SELECT member_id, created_at FROM floor_posts WHERE removed_at IS NULL
    UNION ALL SELECT member_id, created_at FROM floor_replies WHERE removed_at IS NULL
  )
  UNION ALL SELECT member_id, 'lesson', completed_at FROM lesson_progress
  UNION ALL SELECT booked_by, 'call', booked_at FROM call_slots WHERE booked_by IS NOT NULL AND booked_at IS NOT NULL
  UNION ALL SELECT member_id, 'plan', updated_at FROM plans`;

/** What members have done lately, and who has gone quiet. */
export function createActivity(db: Db, now: () => Date = () => new Date()) {
  const billing = createBilling(db, now);

  return {
    /** The most recent thing a member did, or null if they have done nothing yet. */
    last(memberId: number): LastActivity | null {
      const row = db.prepare(`WITH events AS (${EVENTS}) SELECT kind, at FROM events WHERE member_id = ? ORDER BY at DESC, kind LIMIT 1`).get(memberId);
      return row ? { kind: oneOf(row, 'kind', ACTIVITY_KINDS), at: text(row, 'at') } : null;
    },

    /** How many of each thing the member did from `since` on. */
    counts(memberId: number, since: string): Record<ActivityKind, number> {
      const counts: Record<ActivityKind, number> = { session: 0, post: 0, lesson: 0, call: 0, plan: 0 };
      const rows = db.prepare(`WITH events AS (${EVENTS}) SELECT kind, count(*) AS n FROM events WHERE member_id = ? AND at >= ? GROUP BY kind`).all(memberId, since);
      for (const row of rows) counts[oneOf(row, 'kind', ACTIVITY_KINDS)] = integer(row, 'n');
      return counts;
    },

    /**
     * Paying members, in grace included, who have done nothing for QUIET_DAYS, quietest first: those who never have, then
     * the longest since. A member who first paid inside that time is not counted: the getting-started emails are theirs.
     */
    quiet(): QuietMember[] {
      const cutoff = iso(new Date(now().getTime() - QUIET_DAYS * DAY_MS));
      const rows = db
        .prepare(
          `WITH events AS (${EVENTS}),
           latest AS (SELECT member_id, kind, at, row_number() OVER (PARTITION BY member_id ORDER BY at DESC, kind) AS n FROM events)
           SELECT m.id, m.name, m.email, m.joined_at, l.kind, l.at,
             (SELECT min(p.paid_at) FROM payments p WHERE p.member_id = m.id AND p.status = 'paid' AND p.reversed_at IS NULL) AS first_paid_at
           FROM members m JOIN subscriptions s ON s.member_id = m.id
             LEFT JOIN latest l ON l.member_id = m.id AND l.n = 1
           WHERE m.role = 'member' AND ${STATUS_SQL.active}`,
        )
        .all();
      const quiet = rows.flatMap((row): QuietMember[] => {
        const at = optionalText(row, 'at');
        const last = at === null ? null : { kind: oneOf(row, 'kind', ACTIVITY_KINDS), at };
        const began = optionalText(row, 'first_paid_at') ?? text(row, 'joined_at');
        if ((last && last.at > began ? last.at : began) >= cutoff) return [];
        const id = integer(row, 'id');
        const standing = billing.standing(id);
        if (standing.access === 'unpaid' || standing.paidUntil === null) return [];
        return [{ id, name: text(row, 'name'), email: text(row, 'email'), paidUntil: standing.paidUntil, renews: standing.renews, stop: standing.renews ? null : billing.lastStop(id), last }];
      });
      return quiet.sort((a, b) => (a.last?.at ?? '').localeCompare(b.last?.at ?? '') || a.id - b.id);
    },
  };
}
