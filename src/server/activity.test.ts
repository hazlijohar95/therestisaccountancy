import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITY_KINDS, QUIET_DAYS, type ActivityKind } from './activity.ts';
import { migrate } from './db.ts';
import { openDatabase } from './node-db.ts';
import { createStore } from './store.ts';

const DAY_MS = 86_400_000;
const PASSWORD = 'correct horse battery';

/** A club whose clock the test moves. It starts on 1 December, when every member below pays for a year. */
const world = () => {
  let clock = new Date('2026-12-01T10:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  migrate(db);
  const store = createStore(db, now);
  const { club, billing } = store;
  const join = async (email: string, name: string) => {
    club.recordJoinRequest({ name, email, stage: 'I run a practice' });
    const request = club.joinRequests({ decided: false }).find((r) => r.email === email);
    const invited = club.inviteFromRequest(request?.id ?? 0);
    assert.ok(invited.ok && invited.value.kind === 'link');
    const accepted = await club.setPasswordFromLink(invited.value.link.token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  const payer = async (email: string, name: string, term: 'month' | 'year' = 'year') => {
    const member = await join(email, name);
    billing.opened(`p-${member.id}`, member.id, 'checkout', term);
    assert.ok(billing.paid(`p-${member.id}`, false));
    return member;
  };
  /** Writes the row an activity leaves behind, dated `daysAgo` before now. */
  const did = (kind: ActivityKind, memberId: number, daysAgo: number) => {
    const at = new Date(clock.getTime() - daysAgo * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const insert = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);
    if (kind === 'session') {
      const id = insert(`INSERT INTO live_sessions (title, kind, starts_at, minutes, link, detail, created_at) VALUES ('Clinic', 'Clinics', ?, 60, 'x', '', ?)`, at, at).lastInsertRowid;
      insert('INSERT INTO rsvps (session_id, member_id, created_at) VALUES (?, ?, ?)', id, memberId, at);
    } else if (kind === 'post') {
      insert(`INSERT INTO floor_posts (member_id, room, jurisdiction, title, created_at) VALUES (?, 'club', 'Any', 'Monthly or annual billing?', ?)`, memberId, at);
    } else if (kind === 'lesson') {
      insert('INSERT INTO lesson_progress (member_id, lesson_id, completed_at) VALUES (?, ?, ?)', memberId, `lesson-${at}`, at);
    } else if (kind === 'call') {
      insert('INSERT INTO call_slots (starts_at, minutes, link, created_at, booked_by, booked_at, topic) VALUES (?, 30, ?, ?, ?, ?, ?)', at, 'x', at, memberId, at, 'Pricing');
    } else {
      insert('INSERT INTO plans (member_id, created_at, updated_at) VALUES (?, ?, ?)', memberId, at, at);
    }
  };
  return { db, store, now, join, payer, did, later: (days: number) => (clock = new Date(clock.getTime() + days * DAY_MS)) };
};

test('each thing a member does counts, and the latest one is what they last did', async () => {
  const w = world();
  const members = await Promise.all(ACTIVITY_KINDS.map((kind) => w.payer(`${kind}@firm.com.my`, kind)));
  const silent = await w.payer('silent@firm.com.my', 'Silent');
  w.later(60);
  members.forEach((m, i) => w.did(ACTIVITY_KINDS[i] ?? 'post', m.id, 20));

  ACTIVITY_KINDS.forEach((kind, i) => assert.equal(w.store.activity.last(members[i]?.id ?? 0)?.kind, kind));
  assert.equal(w.store.activity.last(silent.id), null);
  assert.deepEqual(w.store.activity.quiet().map((m) => m.name), ['Silent'], 'everyone who did something in the last 30 days is not quiet');

  const m = members[0];
  assert.ok(m);
  w.did('lesson', m.id, 2);
  assert.equal(w.store.activity.last(m.id)?.kind, 'lesson', 'the most recent wins, whatever its kind');
});

test('a reply on the Floor counts as a post, and a removed post or reply is not activity', async () => {
  const w = world();
  const aina = await w.payer('aina@firm.com.my', 'Aina');
  const budi = await w.payer('budi@firm.com.my', 'Budi');
  w.did('post', aina.id, 3);
  w.db.prepare(`INSERT INTO floor_replies (post_id, member_id, body, created_at) SELECT id, ?, 'Annual, with a discount.', '2026-11-30T10:00:00Z' FROM floor_posts`).run(budi.id);
  assert.deepEqual(w.store.activity.last(budi.id), { kind: 'post', at: '2026-11-30T10:00:00Z' });
  w.db.exec('UPDATE floor_posts SET removed_at = created_at; UPDATE floor_replies SET removed_at = created_at');
  assert.equal(w.store.activity.last(aina.id), null);
  assert.equal(w.store.activity.last(budi.id), null);
  w.later(QUIET_DAYS + 1);
  assert.deepEqual(w.store.activity.quiet().map((m) => m.name), ['Aina', 'Budi']);
});

test('only paying members are listed: not unpaid, lapsed past grace, suspended or admins', async () => {
  const w = world();
  const { club } = w.store;
  const lapsed = await w.payer('lapsed@firm.com.my', 'Lapsed', 'month');
  await w.join('unpaid@firm.com.my', 'Unpaid');
  const suspended = await w.payer('suspended@firm.com.my', 'Suspended');
  const admin = await club.ensureAdmin({ email: 'admin@club.test', name: 'Admin', password: PASSWORD });
  w.db.prepare("INSERT INTO subscriptions (member_id, paid_until) VALUES (?, '2027-12-01T10:00:00Z')").run(admin.id);
  club.suspendMember(admin.id, suspended.id, 'https://club.test/');
  const keeper = await w.payer('keeper@firm.com.my', 'Keeper');
  const grace = await w.payer('grace@firm.com.my', 'Grace', 'month');
  w.later(31);
  assert.equal(w.store.billing.access(lapsed.id), 'grace', 'a month from 1 December ends on 1 January');
  assert.deepEqual(w.store.activity.quiet().map((m) => m.name), ['Lapsed', 'Keeper', 'Grace'], 'in grace still counts as paying');
  w.later(3);
  assert.equal(w.store.billing.access(grace.id), 'unpaid');
  assert.deepEqual(w.store.activity.quiet().map((m) => m.name), ['Keeper']);
});

test('someone who paid inside the last 30 days is not quiet yet, however long ago they joined', async () => {
  const w = world();
  const aina = await w.join('aina@firm.com.my', 'Aina');
  w.later(100);
  w.store.billing.opened('p-late', aina.id, 'checkout', 'year');
  assert.ok(w.store.billing.paid('p-late', false));
  w.later(QUIET_DAYS - 1);
  assert.deepEqual(w.store.activity.quiet(), [], 'the getting-started emails are still theirs');
  w.later(2);
  assert.deepEqual(w.store.activity.quiet().map((m) => m.name), ['Aina']);
});

test('never-active members come first, then the longest quiet, ties by id', async () => {
  const w = world();
  const a = await w.payer('a@firm.com.my', 'A');
  const b = await w.payer('b@firm.com.my', 'B');
  const c = await w.payer('c@firm.com.my', 'C');
  const d = await w.payer('d@firm.com.my', 'D');
  const e = await w.payer('e@firm.com.my', 'E');
  w.later(90);
  w.did('post', a.id, 40);
  w.did('lesson', c.id, 60);
  w.did('call', e.id, 35);
  w.did('plan', e.id, 50);
  const quiet = w.store.activity.quiet();
  assert.deepEqual(quiet.map((m) => m.name), ['B', 'D', 'C', 'A', 'E']);
  assert.deepEqual(quiet.map((m) => m.last?.kind ?? null), [null, null, 'lesson', 'post', 'call']);
  assert.deepEqual(quiet[0], { id: b.id, name: 'B', email: 'b@firm.com.my', paidUntil: '2027-12-01T10:00:00Z', renews: true, stop: null, last: null });
});

test('counts tallies each kind from a date on, for that member only', async () => {
  const w = world();
  const aina = await w.payer('aina@firm.com.my', 'Aina');
  const budi = await w.payer('budi@firm.com.my', 'Budi');
  w.later(400);
  for (const daysAgo of [300, 200, 100]) w.did('session', aina.id, daysAgo);
  w.did('post', aina.id, 50);
  w.did('lesson', aina.id, 380);
  w.did('call', aina.id, 10);
  w.did('plan', aina.id, 5);
  w.did('session', budi.id, 10);
  const since = new Date(w.now().getTime() - 365 * DAY_MS).toISOString();
  assert.deepEqual(w.store.activity.counts(aina.id, since), { session: 3, post: 1, lesson: 0, call: 1, plan: 1 });
  assert.deepEqual(w.store.activity.counts(budi.id, since), { session: 1, post: 0, lesson: 0, call: 0, plan: 0 });
  assert.deepEqual(w.store.activity.counts(aina.id, w.now().toISOString()), { session: 0, post: 0, lesson: 0, call: 0, plan: 0 });
});

test('a quiet member who turned renewal off carries why, and one who turned it back on does not', async () => {
  const w = world();
  const aina = await w.payer('aina@firm.com.my', 'Aina');
  const budi = await w.payer('budi@firm.com.my', 'Budi');
  w.store.billing.setRenews(aina.id, false, 'https://club.test', { reason: 'value', note: null });
  w.store.billing.setRenews(budi.id, false, 'https://club.test', { reason: 'time', note: null });
  w.store.billing.setRenews(budi.id, true, 'https://club.test');
  w.later(QUIET_DAYS + 1);
  const [first, second] = w.store.activity.quiet();
  assert.equal(first?.name, 'Aina');
  assert.deepEqual(first?.stop, { at: '2026-12-01T10:00:00Z', reason: 'value', note: null });
  assert.equal(second?.stop, null);
});
