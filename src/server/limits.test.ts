import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLimits, POSTS_PER_MINUTE, sourceOf } from './limits.ts';
import { migrate } from './db.ts';
import { openDatabase } from './node-db.ts';

test('a source gets a few posts a minute, and a pause inside the minute does not reset it', () => {
  let clock = new Date('2026-11-24T10:00:00Z');
  const db = openDatabase(':memory:');
  migrate(db);
  const limits = createLimits(db, () => clock);
  const later = (ms: number) => (clock = new Date(clock.getTime() + ms));

  for (let n = 0; n < POSTS_PER_MINUTE; n++) assert.equal(limits.allow('join 1.2.3.4'), true);
  later(20_000);
  assert.equal(limits.allow('join 1.2.3.4'), false);
  assert.equal(limits.allow('sign-in 1.2.3.4'), true, 'each form counts on its own');
  assert.equal(limits.allow('join 5.6.7.8'), true, 'each source counts on its own');
  assert.equal(limits.full('join 1.2.3.4'), true);
  assert.equal(limits.full('join 5.6.7.8'), false, 'checking counts nothing');

  later(41_000);
  assert.equal(limits.allow('join 1.2.3.4'), true, 'a minute after the first posts, room again');
});

test('IPv6 addresses in one /64 are one source', () => {
  assert.equal(sourceOf('2001:db8:85a3:12::1'), '2001:db8:85a3:12::/64');
  assert.equal(sourceOf('2001:0db8:85a3:0012:ffff:1:2:3'), '2001:db8:85a3:12::/64');
  assert.equal(sourceOf('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(sourceOf('203.0.113.9'), '203.0.113.9');
});
