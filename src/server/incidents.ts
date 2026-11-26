import { integer, text, type Db } from './db.ts';

/** What went wrong without anyone watching: an email, a payment check, a renewal, the hourly job, a document left in R2. */
export const INCIDENT_KINDS = ['email', 'payment', 'renewal', 'job', 'evidence'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export interface Incident {
  readonly at: string;
  readonly kind: string;
  readonly detail: string;
}

const MALAYSIA_MS = 8 * 3_600_000;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The daily summary goes out in the 9 am hour, Malaysia time. */
export const summaryDue = (at: Date) => new Date(at.getTime() + MALAYSIA_MS).getUTCHours() === 9;

/** Failures kept for the admins' daily summary. */
export function createIncidents(db: Db, now: () => Date = () => new Date()) {
  return {
    record(kind: IncidentKind, detail: string): void {
      db.prepare('INSERT INTO incidents (at, kind, detail) VALUES (?, ?, ?)').run(iso(now()), kind, detail.slice(0, 500));
    },

    /** Every failure not yet in a summary, oldest first, with the last id to mark once the summary has gone. */
    unreported(): { readonly incidents: Incident[]; readonly lastId: number } {
      const rows = db.prepare('SELECT id, at, kind, detail FROM incidents WHERE reported_at IS NULL ORDER BY id').all();
      const last = rows.at(-1);
      return { incidents: rows.map((row) => ({ at: text(row, 'at'), kind: text(row, 'kind'), detail: text(row, 'detail') })), lastId: last ? integer(last, 'id') : 0 };
    },

    /** Marks failures up to an id as reported, after the summary holding them was sent. A summary that failed leaves them for the next. */
    reported(lastId: number): void {
      db.prepare('UPDATE incidents SET reported_at = ? WHERE reported_at IS NULL AND id <= ?').run(iso(now()), lastId);
    },
  };
}
