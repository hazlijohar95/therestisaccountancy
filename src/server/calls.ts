import type { Db } from './db.ts';

/** One-to-one call slots the hosts open and members book. */
export function createCalls(db: Db, now: () => Date = () => new Date()) {
  void db;
  void now;
  return {};
}
