import assert from 'node:assert/strict';
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
