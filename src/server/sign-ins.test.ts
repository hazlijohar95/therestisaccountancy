import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { openDatabase } from './node-db.ts';
import { createSignIns, SESSION_DAYS } from './sign-ins.ts';
import { DAY, PASSWORD, value } from './social-fixtures.ts';

function world() {
  let clock = new Date('2026-11-26T02:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  const club = createClub(db, now);
  const signIns = createSignIns(db, now);
  const signIn = async (email: string) => value(await club.authenticate(email, PASSWORD)).key;
  return { club, signIns, signIn, later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

test('a session signs its member in until it is closed', async () => {
  const w = world();
  const host = await w.club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });
  const { token } = w.signIns.open(await w.signIn('host@club.test'));
  const key = w.signIns.key(token);
  assert.ok(key);
  assert.equal(w.club.sessionMember(key)?.id, host.id);
  assert.equal(w.signIns.key('not-a-token'), null);
  w.signIns.close(token);
  w.signIns.close(token);
  assert.equal(w.signIns.key(token), null, 'signed out, and safe to sign out twice');
});

test('a session runs out, and the hourly prune deletes it', async () => {
  const w = world();
  await w.club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });
  const { token } = w.signIns.open(await w.signIn('host@club.test'));
  w.later((SESSION_DAYS - 1) * DAY);
  assert.ok(w.signIns.key(token));
  assert.equal(w.signIns.prune(), 0);
  w.later(2 * DAY);
  assert.equal(w.signIns.key(token), null);
  assert.equal(w.signIns.prune(), 1);
});

test('a password change ends every older session', async () => {
  const w = world();
  const host = await w.club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });
  const { token } = w.signIns.open(await w.signIn('host@club.test'));
  await w.club.changePassword(host.id, PASSWORD, 'another long password');
  const key = w.signIns.key(token);
  assert.ok(key, 'the row stays until it runs out');
  assert.equal(w.club.sessionMember(key), null, 'but it signs nobody in');
});
