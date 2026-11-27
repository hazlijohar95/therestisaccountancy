import assert from 'node:assert/strict';
import type { Db } from './db.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import { createStore } from './store.ts';

/* A whole social site on node:sqlite with a clock the test moves, for the tests of slice 6 and on. Tests only. */

export const PASSWORD = 'correct horse battery';
export const SITE = 'https://therestisaccountancy.com/';
export const DAY = 86_400_000;

export const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
export const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);
export const at = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function socialWorld() {
  let clock = new Date('2026-11-26T02:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  const { club, socialProfiles: profiles, socialClaims: claims, socialNominations: nominations, socialFloor: floor, socialProblems: problems, socialCasebook: casebook, socialShelf: shelf, socialNotifications: notifications, socialInvites: invites, socialRequests: requests } = createStore(db, now);
  const host = club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });

  /** A member who signed up on the social site and set their password. */
  const joined = async (name: string, email: string, handle: string) => {
    const { memberId } = value(profiles.signUp({ name, email, handle }, { via: 'team' }));
    const accepted = await club.setPasswordFromLink(value(club.newLink(memberId)).token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  /** A proven account and a ticked ACCA membership: the seal. Returns the body claim. */
  const seal = async (memberId: number, account: string) => {
    const reviewer = (await host).id;
    const proven = value(claims.addAccount(memberId, 'LinkedIn', account));
    value(claims.decideAccount(proven.id, reviewer, { verdict: 'approve' }));
    const body = value(claims.addClaim(memberId, { kind: 'body', bodyId: 'acca', status: 'Member', reference: '1', otherName: null, evidenceKey: null }));
    value(claims.decideClaim(body.id, reviewer, { verdict: 'approve' }));
    return body;
  };
  return { db, club, profiles, claims, nominations, floor, problems, casebook, shelf, notifications, invites, requests, host, joined, seal, now, later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

/**
 * Undoes the migration that moved the club's board onto the Floor, for a test that rewinds the schema past it and runs
 * the later migrations again. The board comes back empty, so running that migration again moves nothing.
 */
export function unmergeBoard(db: Db): void {
  db.exec(`
    DROP TABLE floor_reply_notices;
    CREATE TABLE threads (
      id INTEGER PRIMARY KEY, channel TEXT NOT NULL, title TEXT NOT NULL, author_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, last_post_at TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, removed_at TEXT
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES members (id) ON DELETE SET NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT
    );
    CREATE TABLE reply_notices (
      member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE, thread_id INTEGER NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
      sent_at TEXT NOT NULL, PRIMARY KEY (member_id, thread_id)
    );
  `);
}
