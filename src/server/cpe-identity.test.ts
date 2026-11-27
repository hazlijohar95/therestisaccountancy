import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBilling } from './billing.ts';
import { createClub } from './club.ts';
import { identify, sessionToken } from './cpe-identity.ts';
import { openDatabase } from './node-db.ts';

const SITE = 'https://therestisaccountancy.com/';

/** A club with one admin and one member who has set a password, both able to sign in. */
const world = async () => {
  let clock = new Date('2026-11-26T10:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  const club = createClub(db, now);
  const billing = createBilling(db, now);
  const admin = club.appointAdmin({ email: 'admin@club.test', name: 'Admin' });
  const adminLink = club.requestLink(admin.email);
  assert.ok(adminLink);
  const adminAccess = await club.setPasswordFromLink(adminLink.token, 'correct horse battery');
  assert.ok(adminAccess);
  club.recordJoinRequest({ name: 'Aina', email: 'aina@firm.com.my', stage: 'I run a practice' });
  const invited = club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0);
  assert.ok(invited.ok && invited.value.kind === 'link');
  const memberAccess = await club.setPasswordFromLink(invited.value.link.token, 'correct horse battery');
  assert.ok(memberAccess);
  return { club, billing, admin: adminAccess, member: memberAccess, later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

test('CPE sees the signed-in member, with paid access only once they pay', async () => {
  const w = await world();
  const who = () => identify(w.club.sessionMember(w.member.key), (id) => w.billing.access(id));
  assert.deepEqual(await who(), { id: w.member.member.id, name: 'Aina', email: 'aina@firm.com.my', role: 'member', paid: false });

  w.billing.opened('p1', w.member.member.id, 'checkout', 'month', 9900);
  w.billing.paid('p1', false);
  assert.equal((await who())?.paid, true);

  w.later(40 * 86_400_000);
  assert.equal((await who())?.paid, false, 'a month paid by FPX runs out with no grace once it is not renewing');
});

test('an admin always has paid access, and no session means nobody', async () => {
  const w = await world();
  const admin = await identify(w.club.sessionMember(w.admin.key), (id) => w.billing.access(id));
  assert.equal(admin?.role, 'admin');
  assert.equal(admin?.paid, true);
  assert.equal(await identify(null, () => 'paid'), null);
});

test('a session ended by suspension or a password change identifies nobody', async () => {
  const w = await world();
  assert.equal(w.club.sessionMember({ memberId: w.member.member.id, epoch: w.member.key.epoch + 1 }), null, 'an older epoch');
  const suspended = w.club.suspendMember(w.admin.member.id, w.member.member.id, SITE);
  assert.ok(suspended.ok);
  assert.equal(await identify(w.club.sessionMember(w.member.key), (id) => w.billing.access(id)), null);
});

test('the session token is read from the forwarded Cookie header, and nothing else counts', () => {
  assert.equal(sessionToken('session=abc'), 'abc');
  assert.equal(sessionToken('theme=dark; session=abc=def; other=1'), 'abc=def', 'a token may hold = signs');
  assert.equal(sessionToken('mysession=abc'), null, 'only the exact name');
  assert.equal(sessionToken('session='), null);
  assert.equal(sessionToken(null), null);
});
