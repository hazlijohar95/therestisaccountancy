import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './node-db.ts';
import { createStore } from './store.ts';

test("the store's modules share one database, one transaction and one clock", () => {
  const db = openDatabase(':memory:');
  const store = createStore(db, () => new Date('2026-11-26T02:00:00Z'));
  const signUp = () => store.socialProfiles.signUp({ name: 'Priya Nair', email: 'priya@tax.my', handle: 'priyataxes' }, { via: 'team' });

  assert.throws(() =>
    db.transaction(() => {
      assert.ok(signUp().ok);
      assert.equal(store.club.members({ limit: 10, offset: 0 }).total, 1, 'the club sees the social sign-up at once');
      throw new Error('called off');
    }),
  );
  assert.equal(store.club.members({ limit: 10, offset: 0 }).total, 0, 'one rollback undoes it for every module');

  assert.ok(signUp().ok);
  assert.equal(store.club.members({ limit: 10, offset: 0 }).items[0]?.joinedAt, '2026-11-26T02:00:00Z');
});
