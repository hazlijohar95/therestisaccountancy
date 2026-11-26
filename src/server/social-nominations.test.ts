import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import { createSocialClaims } from './social-claims.ts';
import { createSocialNominations, type NominationDraft } from './social-nominations.ts';
import { createSocialProfiles } from './social-profiles.ts';

const PASSWORD = 'correct horse battery';

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

const draft = (changes: Partial<NominationDraft> = {}): NominationDraft => ({ platform: 'YouTube', handle: 'taxwithtan', topics: ['Tax'], whyUrl: null, ...changes });

const world = () => {
  const now = () => new Date('2026-11-26T02:00:00Z');
  const db = openDatabase(':memory:');
  const club = createClub(db, now);
  const profiles = createSocialProfiles(db, now);
  const claims = createSocialClaims(db, now);
  const nominations = createSocialNominations(db, now);
  const joined = async (name: string, email: string, handle: string) => {
    const { memberId } = value(profiles.signUp({ name, email, handle }, { via: 'team' }));
    const accepted = await club.setPasswordFromLink(value(club.newLink(memberId)).token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  const host = club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });
  return { db, profiles, claims, nominations, joined, host };
};

test('a second nominator is counted on the same nomination, and nobody counts twice', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');

  assert.equal(value(w.nominations.nominate(aina.id, draft({ whyUrl: 'https://youtube.com/watch?v=1' }))).outcome, 'nominated');
  assert.equal(value(w.nominations.nominate(abu.id, draft({ topics: ['Audit', 'Tax'] }))).outcome, 'counted');
  assert.equal(value(w.nominations.nominate(abu.id, draft())).outcome, 'already');

  const [queued] = w.nominations.queue().pending;
  assert.equal(queued?.nominators, 2);
  assert.deepEqual(queued?.topics, ['Audit', 'Tax'], 'topics from every nominator, in the registry order');
  assert.deepEqual(queued?.links, ['https://youtube.com/watch?v=1']);
  assert.equal(queued?.url, 'https://www.youtube.com/@taxwithtan');
  assert.equal(w.nominations.queue().pending.length, 1, 'one row per handle');
});

test('a nomination is private to the member who made it', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  value(w.nominations.nominate(aina.id, draft()));

  assert.deepEqual(w.nominations.mine(aina.id).map((n) => [n.handle, n.platform, n.state]), [['taxwithtan', 'YouTube', 'pending']]);
  assert.deepEqual(w.nominations.mine(abu.id), []);
  assert.equal(w.profiles.list().length, 2, 'The List holds members only');
});

test('a handle someone has proven is on The List already, and only a proven one counts', async () => {
  const w = world();
  const host = await w.host;
  const tan = await w.joined('Tan', 'tan@firm.my', 'tanyt');
  const squatter = await w.joined('Squatter', 'sq@firm.my', 'squatter');
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');

  value(w.claims.addAccount(squatter.id, 'YouTube', 'taxwithtan'));
  assert.equal(reason(w.nominations.nominate(aina.id, draft())), null, 'a pending account blocks nothing');

  const account = value(w.claims.addAccount(tan.id, 'X', 'tanyt'));
  value(w.claims.decideAccount(account.id, host.id, { verdict: 'approve' }));
  assert.equal(reason(w.nominations.nominate(aina.id, draft({ platform: 'X', handle: 'tanyt' }))), 'on-list');
  assert.equal(w.nominations.onList('X', 'tanyt'), 'tanyt');
  assert.equal(reason(w.nominations.nominate(aina.id, draft({ platform: 'X', handle: 'not a handle' }))), 'handle-invalid');
});

test('the team invites with a link shown once; the nominee claims it and it stops working', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  value(w.nominations.nominate(aina.id, draft()));
  value(w.nominations.nominate(abu.id, draft({ topics: ['Audit'] })));
  const id = w.nominations.queue().pending[0]?.id ?? 0;

  const { token } = value(w.nominations.invite(id, host.id));
  assert.equal(reason(w.nominations.invite(id, host.id)), 'already', 'a second invite does not replace the link the team sent');
  assert.deepEqual(w.nominations.invitation(token), { platform: 'YouTube', handle: 'taxwithtan', nominators: 2, topics: ['Audit', 'Tax'] });
  assert.equal(w.nominations.queue().invited.length, 1);
  assert.equal(w.nominations.mine(aina.id)[0]?.state, 'invited');

  const fresh = value(w.nominations.relink(id, host.id)).token;
  assert.equal(w.nominations.invitation(token), null, 'a new link retires the old one');
  assert.equal(value(w.nominations.claim(abu.id, fresh)).platform, 'YouTube');
  assert.equal(w.nominations.invitation(fresh), null);
  assert.equal(reason(w.nominations.claim(aina.id, fresh)), 'not-found');
  assert.deepEqual(w.nominations.mine(aina.id), []);
  assert.equal(reason(w.nominations.nominate(abu.id, draft())), 'closed');
});

test('a nominee who says no is never invited again, and nothing about the nomination is kept', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  value(w.nominations.nominate(aina.id, draft({ whyUrl: 'https://youtube.com/watch?v=1' })));
  const id = w.nominations.queue().pending[0]?.id ?? 0;
  const { token } = value(w.nominations.invite(id, host.id));

  assert.equal(w.nominations.decline(token), true);
  assert.equal(w.nominations.decline(token), false);
  assert.equal(w.nominations.invitation(token), null);
  assert.equal(w.db.prepare('SELECT count(*) AS n FROM nominators').get()?.n, 0);
  assert.deepEqual(w.nominations.queue(), { pending: [], invited: [] });
  assert.deepEqual(w.nominations.mine(aina.id), []);
  const again = await w.joined('Abu', 'abu@firm.my', 'abu');
  assert.equal(reason(w.nominations.nominate(again.id, draft())), 'closed');
});

test('a rejected nomination leaves the queue and its link stops working', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  value(w.nominations.nominate(aina.id, draft()));
  const id = w.nominations.queue().pending[0]?.id ?? 0;
  const { token } = value(w.nominations.invite(id, host.id));
  value(w.nominations.reject(id, host.id));
  assert.equal(reason(w.nominations.reject(id, host.id)), 'not-found');
  assert.equal(w.nominations.invitation(token), null);
  assert.deepEqual(w.nominations.queue(), { pending: [], invited: [] });
  assert.deepEqual(w.nominations.mine(aina.id), []);
});
