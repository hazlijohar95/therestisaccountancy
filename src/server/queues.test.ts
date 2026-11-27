import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSections } from '../data/plan.ts';
import { openDatabase } from './node-db.ts';
import { hostQueues, STALE_MS } from './queues.ts';
import type { Result } from './result.ts';
import { createStore } from './store.ts';

const PASSWORD = 'correct horse battery';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};

const world = async () => {
  let clock = new Date('2026-11-24T01:00:00Z');
  const store = createStore(openDatabase(':memory:'), () => clock);
  const host = await store.club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });
  const joined = async (name: string, email: string, handle: string) => {
    const { memberId } = value(store.socialProfiles.signUp({ name, email, handle }, { via: 'team' }));
    const accepted = await store.club.setPasswordFromLink(value(store.club.newLink(memberId)).token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  const later = (ms: number) => (clock = new Date(clock.getTime() + ms));
  return { store, host, joined, later, now: () => clock };
};

const byId = (queues: ReturnType<typeof hostQueues>) => Object.fromEntries(queues.map((q) => [q.id, q]));

test('every queue reads its own module, with the oldest wait in days, and goes stale only past two days', async () => {
  const w = await world();
  const start = w.now().getTime();
  w.store.club.recordJoinRequest({ name: 'Aina Rahman', email: 'aina@firm.com.my', stage: 'I run a practice' });
  w.store.club.recordJoinRequest({ name: 'Abu Musa', email: 'abu@firm.com.my', stage: 'I work in a firm' });
  w.later(HOUR);
  value(w.store.socialRequests.request({ name: 'Siti Aminah', email: 'siti@firm.my', about: 'Audit senior.', link: null }));

  const fresh = w.store.queues.host();
  assert.deepEqual(
    fresh.map((q) => q.id),
    ['club-requests', 'listings', 'plans', 'accounts', 'credentials', 'documents', 'nominations', 'reports', 'social-requests'],
  );
  assert.deepEqual(
    fresh.filter((q) => q.count === 0).map((q) => [q.since, q.ageDays, q.stale]),
    Array.from({ length: 7 }, () => [null, 0, false]),
    'an empty queue has no age and is never stale',
  );

  const at = (ms: number) => byId(hostQueues(w.store, new Date(start + ms)));
  assert.deepEqual(at(STALE_MS)['club-requests'], {
    id: 'club-requests',
    label: 'Club join requests',
    where: { site: 'club', path: '/admin#pending-title' },
    count: 2,
    since: '2026-11-24T01:00:00Z',
    ageDays: 2,
    stale: false,
  }, 'exactly two days is not yet stale');
  assert.equal(at(STALE_MS + 1000)['club-requests']?.stale, true, 'a second past two days is');
  assert.deepEqual(at(STALE_MS + 1000)['social-requests'], {
    id: 'social-requests',
    label: 'Social join requests',
    where: { site: 'social', path: '/review?tab=requests' },
    count: 1,
    since: '2026-11-24T02:00:00Z',
    ageDays: 1,
    stale: false,
  });
});

test('the morning nudge names every stale queue in one incident, once a day', async () => {
  const w = await world();
  w.store.club.recordJoinRequest({ name: 'Aina Rahman', email: 'aina@firm.com.my', stage: 'I run a practice' });
  w.later(DAY);
  value(w.store.socialRequests.request({ name: 'Siti Aminah', email: 'siti@firm.my', about: 'Audit senior.', link: null }));
  assert.equal(w.store.queues.nudge(), null, 'nothing stale, nothing recorded');

  w.later(2 * DAY);
  const detail = 'Waiting more than 2 days. Club join requests: 1, oldest 3 days.';
  assert.equal(w.store.queues.nudge(), detail);
  w.later(HOUR);
  assert.equal(w.store.queues.nudge(), null, 'a rerun the same morning records nothing');
  assert.deepEqual(w.store.incidents.unreported().incidents.map((i) => [i.kind, i.detail]), [['queue', detail]]);

  w.later(DAY - HOUR);
  assert.equal(w.store.queues.nudge(), 'Waiting more than 2 days. Club join requests: 1, oldest 4 days; Social join requests: 1, oldest 3 days.');
  assert.equal(w.store.incidents.unreported().incidents.length, 2, 'the next morning it is named again');
});

test('with every queue stale, the nudge still fits in one incident', async () => {
  const w = await world();
  const reviewer = w.host.id;
  const [aina, abu, siti] = [
    await w.joined('Aina Rahman', 'aina@firm.com.my', 'ainarahman'),
    await w.joined('Abu Musa', 'abu@firm.com.my', 'abumusa'),
    await w.joined('Siti Aminah', 'siti@firm.com.my', 'sitiaminah'),
  ];
  const proven = value(w.store.socialClaims.addAccount(aina.id, 'LinkedIn', 'aina-rahman'));
  value(w.store.socialClaims.decideAccount(proven.id, reviewer, { verdict: 'approve' }));
  const ticked = value(w.store.socialClaims.addClaim(aina.id, { kind: 'body', bodyId: 'acca', status: 'Member', reference: '1', otherName: null, evidenceKey: null }));
  value(w.store.socialClaims.decideClaim(ticked.id, reviewer, { verdict: 'approve' }));

  w.store.club.recordJoinRequest({ name: 'New Person', email: 'new@firm.com.my', stage: 'I run a practice' });
  w.store.listings.save(abu.id, {
    practice: 'Musa & Co',
    state: 'Selangor',
    town: 'Petaling Jaya',
    remote: false,
    services: ['bookkeeping'],
    niche: 'Clinics',
    bio: 'Books and tax for small companies.',
    qualifications: 'ACCA',
    website: null,
    contactEmail: 'abu@firm.com.my',
  });
  value(w.store.plans.send(abu.id, Object.fromEntries(planSections.map((s) => [s.slug, `${s.heading}, written down.`]))));
  value(w.store.socialClaims.addAccount(abu.id, 'LinkedIn', 'abu-musa'));
  value(w.store.socialClaims.addClaim(abu.id, { kind: 'body', bodyId: 'acca', status: 'Member', reference: '2', otherName: null, evidenceKey: null }));
  value(w.store.socialClaims.addClaim(siti.id, { kind: 'licence', licence: 'Licensed tax agent', reference: 'TA/1', until: '2027-06', evidenceKey: 'claims/1/a' }));
  value(w.store.socialNominations.nominate(abu.id, { platform: 'Threads', handle: 'nominee_one', topics: [], whyUrl: null }));
  const post = value(w.store.socialFloor.post(aina.id, { room: 'open', jurisdiction: 'MY', title: 'A client called', body: 'It names Client Sdn Bhd.' }));
  value(w.store.socialFloor.report(abu.id, { target: 'post', id: post.id }, 'client', ''));
  value(w.store.socialRequests.request({ name: 'Another Person', email: 'another@firm.my', about: 'Tax senior.', link: null }));

  w.later(STALE_MS + DAY);
  const queues = w.store.queues.host();
  assert.deepEqual(queues.filter((q) => !q.stale), [], 'every queue has something stale');
  const detail = w.store.queues.nudge();
  assert.ok(detail);
  assert.equal(w.store.incidents.unreported().incidents[0]?.detail, detail, 'kept whole, not cut short');
  assert.ok(detail.length + queues.length * 6 <= 500, 'with room left for four-digit counts and three-digit ages');
});
