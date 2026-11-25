import type { Db } from './db.ts';

/** The anonymous fee survey: responses, editions and their results. */
export function createFees(db: Db, now: () => Date = () => new Date()) {
  void db;
  void now;
  return {};
}
