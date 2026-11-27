import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createClub, JOIN_ALERTS_PER_HOUR, type Club, type Invitation, type PasswordLink } from './club.ts';
import { SCHEMA_VERSION } from './db.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';

const SITE = 'https://therestisaccountancy.com/';

const fresh = (now = () => new Date('2026-11-24T10:00:00Z')) => createClub(openDatabase(':memory:'), now);
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a brand new password';

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

/** The password link an accepted join request sent. */
const sentLink = (result: Result<Invitation, string>): PasswordLink => {
  const invitation = value(result);
  assert.ok(invitation.kind === 'link', 'expected a password link');
  return invitation.link;
};

/** A member who has accepted an invitation and set PASSWORD. */
const activeMember = async (club: Club, email = 'aina@firm.com.my', name = 'Aina Rahman') => {
  club.recordJoinRequest({ name, email, stage: 'I run a practice' });
  const request = club.joinRequests().find((r) => r.email === email && r.status === 'pending');
  assert.ok(request);
  const link = sentLink(club.inviteFromRequest(request.id));
  const accepted = await club.setPasswordFromLink(link.token, PASSWORD);
  assert.ok(accepted);
  return accepted.member;
};

const admin = (club: Club, email = 'admin@club.test', name = 'Admin') => club.ensureAdmin({ email, name, password: PASSWORD });

test('admins hear of each new request, up to the hourly allowance', () => {
  let clock = new Date('2026-11-24T10:00:00Z');
  const club = createClub(openDatabase(':memory:'), () => clock);
  const ask = (n: number) => club.recordJoinRequest({ name: `Person ${n}`, email: `p${n}@firm.com.my`, stage: 'I run a practice' });

  assert.equal(ask(0), true);
  assert.equal(ask(0), false, 'a repeat from the same email is not news');
  for (let n = 1; n < JOIN_ALERTS_PER_HOUR; n++) assert.equal(ask(n), true);
  assert.equal(ask(JOIN_ALERTS_PER_HOUR), false, 'past the allowance the request is saved without an alert');
  assert.equal(club.joinRequests({ decided: false }).length, JOIN_ALERTS_PER_HOUR + 1, 'every request still waits on the admin page');

  clock = new Date(clock.getTime() + 61 * 60_000);
  assert.equal(ask(99), true, 'an hour later alerts resume');
});

test('a second request from the same email updates the pending one', () => {
  const club = fresh();
  club.recordJoinRequest({ name: 'Aina', email: 'aina@firm.com.my', stage: 'I run a practice' });
  club.recordJoinRequest({ name: 'Aina Rahman', email: 'AINA@firm.com.my', stage: "I'm about to open one" });
  const requests = club.joinRequests();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.name, 'Aina Rahman');
  assert.equal(requests[0]?.status, 'pending');
});

test('an invited request becomes a member who can set a password once, then sign in', async () => {
  const club = fresh();
  club.recordJoinRequest({ name: 'Aina', email: 'aina@firm.com.my', stage: 'I run a practice' });
  const request = club.joinRequests()[0];
  assert.ok(request);
  const invitation = sentLink(club.inviteFromRequest(request.id));
  assert.equal(invitation.purpose, 'welcome');
  assert.equal(invitation.member.status, 'invited');
  assert.equal(club.joinRequests()[0]?.status, 'invited');
  assert.equal(reason(club.inviteFromRequest(request.id)), 'decided', 'a request is invited once');

  assert.equal(club.linkMember(invitation.token)?.email, 'aina@firm.com.my');
  const accepted = await club.setPasswordFromLink(invitation.token, PASSWORD);
  assert.equal(accepted?.purpose, 'welcome');
  assert.equal(accepted?.member.status, 'active');
  assert.equal(await club.setPasswordFromLink(invitation.token, 'another password here'), null, 'an invitation works once');

  assert.equal(value(await club.authenticate('aina@firm.com.my', PASSWORD)).member.id, accepted?.member.id);
  assert.equal(reason(await club.authenticate('aina@firm.com.my', 'wrong password!!')), 'no-match');
  assert.equal(reason(await club.authenticate('nobody@firm.com.my', PASSWORD)), 'no-match');
});

test('an invitation expires, and a new one replaces the old', async () => {
  let clock = new Date('2026-11-24T10:00:00Z');
  const club = fresh(() => clock);
  club.recordJoinRequest({ name: 'Abu', email: 'abu@firm.com.my', stage: 'I work in a firm' });
  const first = sentLink(club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0));
  const second = value(club.newLink(first.member.id));
  assert.equal(second.purpose, 'welcome');
  assert.equal(club.linkMember(first.token), null, 'a new link retires the earlier one');
  clock = new Date('2026-12-09T10:00:01Z');
  assert.equal(await club.setPasswordFromLink(second.token, PASSWORD), null, 'fifteen days later the link has expired');
});

test('declined requests stay declined, and there is no link for a member who does not exist', () => {
  const club = fresh();
  club.recordJoinRequest({ name: 'Shukri', email: 'shukri@firm.com.my', stage: 'I work in industry' });
  const id = club.joinRequests()[0]?.id ?? 0;
  assert.equal(club.declineRequest(id), true);
  assert.equal(reason(club.inviteFromRequest(id)), 'decided');
  assert.equal(reason(club.newLink(999)), 'not-found');
});

test('a reset link sets a new password once, lasts three days, and ends older sessions', async () => {
  let clock = new Date('2026-11-24T10:00:00Z');
  const club = fresh(() => clock);
  const me = await admin(club);
  const before = value(await club.authenticate('admin@club.test', PASSWORD));
  assert.equal(club.sessionMember(before.key)?.id, me.id);

  const expired = value(club.newLink(me.id));
  assert.equal(expired.purpose, 'reset');
  clock = new Date('2026-11-27T10:00:01Z');
  assert.equal(club.linkMember(expired.token), null, 'three days and a second later the reset link has expired');

  const reset = value(club.newLink(me.id));
  const after = await club.setPasswordFromLink(reset.token, NEW_PASSWORD);
  assert.ok(after);
  assert.equal(after.purpose, 'reset');
  assert.equal(club.sessionMember(before.key), null, 'the session opened with the old password has ended');
  assert.equal(club.sessionMember(after.key)?.id, me.id);
  assert.equal(reason(await club.authenticate('admin@club.test', PASSWORD)), 'no-match');
  assert.ok((await club.authenticate('admin@club.test', NEW_PASSWORD)).ok);
  assert.equal(await club.setPasswordFromLink(reset.token, 'yet another password'), null, 'a reset link works once');
});

test('setting a password any other way retires open links', async () => {
  const club = fresh();
  club.recordJoinRequest({ name: 'Aina', email: 'aina@firm.com.my', stage: 'I run a practice' });
  const invitation = sentLink(club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0));
  await admin(club, 'aina@firm.com.my', 'Aina');
  assert.equal(club.linkMember(invitation.token), null, 'running the admin script retires an open invitation');

  const reset = value(club.newLink(invitation.member.id));
  assert.ok(await club.changePassword(invitation.member.id, PASSWORD, NEW_PASSWORD));
  assert.equal(club.linkMember(reset.token), null, 'changing the password retires an open reset link');
});

test('changing a password needs the current one and ends older sessions', async () => {
  const club = fresh();
  const me = await admin(club);
  const elsewhere = value(await club.authenticate('admin@club.test', PASSWORD));
  assert.equal(await club.changePassword(me.id, 'not the password', NEW_PASSWORD), null);
  assert.equal(club.sessionMember(elsewhere.key)?.id, me.id, 'a failed change ends nothing');
  const changed = await club.changePassword(me.id, PASSWORD, NEW_PASSWORD);
  assert.ok(changed);
  assert.equal(club.sessionMember(elsewhere.key), null);
  assert.equal(club.sessionMember(changed.key)?.id, me.id, 'the session that made the change carries on');
});

test('a session for a member who has not set a password, or from another epoch, is refused', async () => {
  const club = fresh();
  club.recordJoinRequest({ name: 'Abu', email: 'abu@firm.com.my', stage: 'I work in a firm' });
  const invitation = sentLink(club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0));
  assert.equal(club.sessionMember({ memberId: invitation.member.id, epoch: 0 }), null);
  const me = await admin(club);
  const { key } = value(await club.authenticate('admin@club.test', PASSWORD));
  assert.equal(club.sessionMember({ memberId: me.id, epoch: key.epoch + 1 }), null);
});

test('a join request cannot rename an active member', async () => {
  const club = fresh();
  const me = await admin(club);
  club.recordJoinRequest({ name: 'Not The Admin', email: 'admin@club.test', stage: 'I run a practice' });
  const link = sentLink(club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0));
  assert.equal(link.purpose, 'reset');
  assert.equal(link.member.id, me.id);
  assert.equal(link.member.name, 'Admin');
  assert.equal((await admin(club, 'admin@club.test', 'Club Admin')).name, 'Club Admin', 'the admin script still renames');
});

test('a password change loses to a reset that lands while it is hashing', async () => {
  const club = fresh();
  const me = await admin(club);
  const reset = value(club.newLink(me.id));
  const change = club.changePassword(me.id, PASSWORD, 'attacker chosen password');
  assert.ok(await club.setPasswordFromLink(reset.token, 'member chosen password'));
  assert.equal(await change, null);
  assert.ok((await club.authenticate('admin@club.test', 'member chosen password')).ok);
});

test('an unknown link is refused before any password is hashed', async () => {
  const club = fresh();
  const started = performance.now();
  assert.equal(await club.setPasswordFromLink('no-such-token', PASSWORD), null);
  assert.ok(performance.now() - started < 20, 'no scrypt work for a token that does not exist');
});

test('suspension ends sessions, blocks sign-in and links, and reinstatement does not revive old sessions', async () => {
  const club = fresh();
  const me = await admin(club);
  const aina = await activeMember(club);
  const session = value(await club.authenticate(aina.email, PASSWORD));
  const openReset = value(club.newLink(aina.id));

  assert.equal(value(club.suspendMember(me.id, aina.id, SITE)).member.status, 'suspended');
  assert.equal(value(club.suspendMember(me.id, aina.id, SITE)).member.status, 'suspended', 'suspending twice is harmless');
  assert.equal(club.sessionMember(session.key), null, 'signed out at once');
  assert.equal(reason(await club.authenticate(aina.email, PASSWORD)), 'suspended', 'told why, once the password is right');
  assert.equal(reason(await club.authenticate(aina.email, 'wrong password!!')), 'no-match', 'a guesser learns nothing');
  assert.equal(club.linkMember(openReset.token), null, 'the open reset link is retired');
  assert.equal(reason(club.newLink(aina.id)), 'suspended');
  club.recordJoinRequest({ name: 'Aina', email: aina.email, stage: 'I run a practice' });
  const again = club.joinRequests().find((r) => r.status === 'pending');
  assert.ok(again);
  assert.equal(reason(club.inviteFromRequest(again.id)), 'suspended', 'a new request does not get round it');
  assert.equal(club.joinRequests().find((r) => r.id === again.id)?.status, 'pending', 'the refused invitation changed nothing');
  assert.deepEqual(club.joinRequests({ decided: false }).map((r) => r.id), [again.id]);
  assert.equal(club.joinRequests({ decided: true, limit: 1 }).length, 1);

  assert.equal(value(club.reinstateMember(aina.id)).status, 'active');
  assert.equal(club.sessionMember(session.key), null, 'the session from before the suspension stays ended');
  assert.ok((await club.authenticate(aina.email, PASSWORD)).ok);
  assert.equal(reason(club.reinstateMember(999)), 'not-found');
});

test('an admin cannot suspend, remove or demote themselves', async () => {
  const club = fresh();
  const me = await admin(club);
  assert.equal(reason(club.suspendMember(me.id, me.id, SITE)), 'self');
  assert.equal(reason(club.removeMember(me.id, me.id, SITE)), 'self');
  assert.equal(reason(club.updateMember(me.id, me.id, { name: 'Admin', email: me.email, role: 'member' }, SITE)), 'self');
  assert.equal(
    value(club.updateMember(me.id, me.id, { name: 'Renamed Admin', email: me.email }, SITE)).member.name,
    'Renamed Admin',
    'without a role, an admin can edit their own details',
  );
});

test('the club always keeps one active admin, even when two admins act on each other at once', async () => {
  const club = fresh();
  const first = await admin(club, 'first@club.test', 'First');
  const second = await admin(club, 'second@club.test', 'Second');
  assert.equal(value(club.updateMember(first.id, second.id, { name: 'Second', email: second.email, role: 'member' }, SITE)).member.role, 'member');
  assert.equal(
    reason(club.updateMember(second.id, first.id, { name: 'First', email: first.email, role: 'member' }, SITE)),
    'last-admin',
    'a stale request from the demoted admin',
  );
  assert.equal(reason(club.suspendMember(second.id, first.id, SITE)), 'last-admin');
  assert.equal(reason(club.removeMember(second.id, first.id, SITE)), 'last-admin');
  assert.equal(club.member(first.id)?.role, 'admin', 'every refusal rolled back');
  assert.equal(club.member(first.id)?.status, 'active');
});

test('editing a member refuses an email another member uses, in any case', async () => {
  const club = fresh();
  const me = await admin(club);
  const aina = await activeMember(club);
  assert.equal(reason(club.updateMember(me.id, aina.id, { name: 'Aina', email: 'ADMIN@club.test' }, SITE)), 'email-taken');
  const edited = value(club.updateMember(me.id, aina.id, { name: 'Aina R.', email: 'aina@new.com.my', role: 'admin' }, SITE)).member;
  assert.deepEqual([edited.name, edited.email, edited.role], ['Aina R.', 'aina@new.com.my', 'admin']);
  assert.ok((await club.authenticate('aina@new.com.my', PASSWORD)).ok, 'she signs in with the new email');
  assert.equal(reason(club.updateMember(me.id, 999, { name: 'Nobody', email: 'nobody@x.my' }, SITE)), 'not-found');
});

test('removing a member deletes their account, progress, links and join request, even after an email change', async () => {
  const club = fresh();
  const me = await admin(club);
  const aina = await activeMember(club);
  club.setLessonDone(aina.id, 'pricing/your-floor-rate', true);
  const reset = value(club.newLink(aina.id));
  value(club.updateMember(me.id, aina.id, { name: 'Aina', email: 'aina@elsewhere.my' }, SITE));

  value(club.removeMember(me.id, aina.id, SITE));
  assert.equal(club.member(aina.id), null);
  assert.equal(club.completedLessons(aina.id).size, 0);
  assert.equal(club.linkMember(reset.token), null);
  assert.equal(club.joinRequests().length, 0, 'the request is linked to the member, not matched by email');
  assert.equal(reason(club.removeMember(me.id, aina.id, SITE)), 'not-found');
});

test('the admin script lifts a suspension: it is the way back in', async () => {
  const club = fresh();
  const first = await admin(club, 'first@club.test', 'First');
  const second = await admin(club, 'second@club.test', 'Second');
  value(club.suspendMember(second.id, first.id, SITE));
  assert.equal((await admin(club, 'first@club.test', 'First')).status, 'active');
});

test('the member list searches names and emails literally, filters by status and pages', async () => {
  const club = fresh();
  await admin(club);
  await activeMember(club, 'aina@firm.com.my', 'Aina Rahman');
  await activeMember(club, 'abu_musa@firm.com.my', 'Abu Musa');
  club.recordJoinRequest({ name: 'Siti 100%', email: 'siti@firm.com.my', stage: 'I run a practice' });
  sentLink(club.inviteFromRequest(club.joinRequests().find((r) => r.status === 'pending')?.id ?? 0));

  const page = (filter: { query?: string; status?: 'invited' | 'active' | 'suspended' }, limit = 10, offset = 0) =>
    club.members({ ...filter, limit, offset });
  assert.deepEqual(
    page({ query: 'firm' }).items.map((m) => m.name),
    ['Aina Rahman', 'Abu Musa', 'Siti 100%'],
  );
  assert.equal(page({ query: '_' }).total, 1, 'an underscore is a character, not a wildcard');
  assert.equal(page({ query: '%' }).total, 1, 'so is a percent sign');
  assert.equal(page({ status: 'invited' }).items[0]?.name, 'Siti 100%');
  assert.deepEqual(club.memberCounts(), { invited: 1, active: 3, suspended: 0 });
  const second = page({}, 2, 2);
  assert.equal(second.total, 4);
  assert.deepEqual(
    second.items.map((m) => m.name),
    ['Abu Musa', 'Siti 100%'],
  );
});

test('lesson progress toggles per member', async () => {
  const club = fresh();
  const me = await admin(club);
  club.setLessonDone(me.id, 'pricing/floor-rate', true);
  club.setLessonDone(me.id, 'pricing/floor-rate', true);
  assert.deepEqual([...club.completedLessons(me.id)], ['pricing/floor-rate']);
  club.setLessonDone(me.id, 'pricing/floor-rate', false);
  assert.equal(club.completedLessons(me.id).size, 0);
});

test('an existing database is upgraded in place and keeps its rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'club-'));
  const path = join(dir, 'club.sqlite');
  try {
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE members (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member', password_hash TEXT, joined_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');
      CREATE TABLE join_requests (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE, stage TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z', decided_at TEXT);
      INSERT INTO members (email, name) VALUES ('old@firm.com.my', 'Old Member');
      INSERT INTO join_requests (name, email, stage, status) VALUES ('Old Member', 'OLD@firm.com.my', 'I run a practice', 'invited');
    `);
    old.close();

    const upgraded = openDatabase(path);
    assert.equal(upgraded.prepare('SELECT max(version) AS n FROM schema_version').get()?.['n'], SCHEMA_VERSION);
    const kept = createClub(upgraded).members({ limit: 10, offset: 0 }).items[0];
    assert.equal(kept?.name, 'Old Member');
    assert.equal(kept?.status, 'invited');
    assert.equal(upgraded.prepare('SELECT member_id FROM join_requests').get()?.['member_id'], kept?.id, 'old requests are linked to their member');
    upgraded.close();

    const reopened = openDatabase(path);
    assert.equal(createClub(reopened).members({ limit: 10, offset: 0 }).total, 1, 'opening again runs nothing twice');
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a member can ask for their own link, at most once every few minutes', async () => {
  let clock = new Date('2026-11-24T10:00:00Z');
  const club = createClub(openDatabase(':memory:'), () => clock);
  const member = await activeMember(club);
  assert.equal(club.requestLink('aina@firm.com.my'), null, 'the invitation just sent counts as a recent link');
  clock = new Date(clock.getTime() + 11 * 60_000);
  assert.equal(club.requestLink('nobody@firm.com.my'), null, 'an unknown email gets nothing');

  const first = club.requestLink('AINA@firm.com.my');
  assert.equal(first?.member.id, member.id);
  assert.equal(first?.purpose, 'reset');
  assert.equal(club.requestLink('aina@firm.com.my'), null, 'a second request straight away is ignored');
  assert.equal(club.linkMember(first?.token ?? '')?.id, member.id, 'and the first link still works');

  clock = new Date(clock.getTime() + 11 * 60_000);
  const second = club.requestLink('aina@firm.com.my');
  assert.ok(second);
  assert.equal(club.linkMember(first?.token ?? ''), null, 'a newer link retires the older one');
});

test('an invited member who lost their invitation can ask for a fresh one', () => {
  const club = fresh();
  club.recordJoinRequest({ name: 'Abu', email: 'abu@firm.com.my', stage: 'I work in a firm' });
  const request = club.joinRequests()[0];
  assert.ok(request);
  sentLink(club.inviteFromRequest(request.id));
  assert.equal(club.requestLink('abu@firm.com.my'), null, 'not while the invitation is minutes old');
});

test('a suspended member cannot ask for a link', async () => {
  const club = fresh();
  const boss = await admin(club);
  const member = await activeMember(club);
  value(club.suspendMember(boss.id, member.id, SITE));
  assert.equal(club.requestLink(member.email), null);
});

test('an appointed admin starts invited and sets a password through a link', async () => {
  const club = fresh();
  const appointed = club.appointAdmin({ email: 'founder@club.test', name: 'Founder' });
  assert.equal(appointed.role, 'admin');
  assert.equal(appointed.status, 'invited');
  assert.deepEqual(club.adminEmails(), [], 'an admin without a password receives no news yet');

  const link = club.requestLink('founder@club.test');
  assert.equal(link?.purpose, 'welcome');
  assert.ok(await club.setPasswordFromLink(link?.token ?? '', PASSWORD));
  assert.deepEqual(club.adminEmails(), ['founder@club.test']);

  assert.equal(club.appointAdmin({ email: 'founder@club.test', name: 'Someone Else' }).status, 'active', 'appointing again keeps the password');
});

test('the join requests waiting count as the admin page lists them, each since it was last sent', () => {
  let clock = new Date('2026-11-24T10:00:00Z');
  const club = createClub(openDatabase(':memory:'), () => clock);
  const later = (hours: number) => (clock = new Date(clock.getTime() + hours * 3_600_000));
  assert.deepEqual(club.waiting(), { count: 0, since: null });

  club.recordJoinRequest({ name: 'Aina Rahman', email: 'aina@firm.com.my', stage: 'I run a practice' });
  later(1);
  club.recordJoinRequest({ name: 'Abu Musa', email: 'abu@firm.com.my', stage: 'I work in a firm' });
  assert.deepEqual(club.waiting(), { count: 2, since: '2026-11-24T10:00:00Z' });

  later(1);
  club.recordJoinRequest({ name: 'Aina Rahman', email: 'aina@firm.com.my', stage: 'I work in a firm' });
  assert.deepEqual(club.waiting(), { count: 2, since: '2026-11-24T11:00:00Z' }, 'asking again starts her wait over');

  const abu = club.joinRequests({ decided: false }).find((r) => r.email === 'abu@firm.com.my');
  assert.ok(abu);
  assert.equal(club.declineRequest(abu.id), true);
  assert.deepEqual(club.waiting(), { count: 1, since: '2026-11-24T12:00:00Z' }, 'a decided request leaves the count');
  assert.equal(club.waiting().count, club.joinRequests({ decided: false }).length);
});
