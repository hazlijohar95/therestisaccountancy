import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBilling } from './billing.ts';
import { createClub } from './club.ts';
import { identify, identityRequest, isIdentityRequest, parseIdentity } from './cpe-identity.ts';
import { openDatabase } from './node-db.ts';

const SITE = 'https://therestisaccountancy.com';

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

  w.billing.opened('p1', w.member.member.id, 'checkout', 'month');
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
  const suspended = w.club.suspendMember(w.admin.member.id, w.member.member.id);
  assert.ok(suspended.ok);
  assert.equal(await identify(w.club.sessionMember(w.member.key), (id) => w.billing.access(id)), null);
});

test('the identity route answers only requests made inside this isolate', () => {
  const inside = identityRequest(SITE, 'session=abc');
  assert.equal(isIdentityRequest(inside), true);
  assert.equal(inside.headers.get('cookie'), 'session=abc', 'the browser cookie is forwarded as it came');
  assert.equal(new URL(inside.url).origin, SITE);

  assert.equal(isIdentityRequest(new Request(inside.url)), false, 'no token');
  assert.equal(isIdentityRequest(new Request(inside.url, { headers: { 'x-cpe-identity': 'guess' } })), false, 'a guessed token');
  assert.equal(isIdentityRequest(new Request(inside.url, { headers: { 'x-cpe-identity': '' } })), false, 'an empty token');
  assert.equal(identityRequest(SITE, null).headers.has('cookie'), false, 'no cookie is sent when there is none');
});

test('identity read back from the route fails loudly on the wrong shape', () => {
  const good = { id: 7, name: 'Aina', email: 'aina@firm.com.my', role: 'member', paid: true };
  assert.deepEqual(parseIdentity(good), good);
  assert.equal(parseIdentity(null), null);
  assert.throws(() => parseIdentity({ ...good, role: 'owner' }));
  assert.throws(() => parseIdentity({ ...good, paid: 'yes' }));
  assert.throws(() => parseIdentity('Aina'));
});
