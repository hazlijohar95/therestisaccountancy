import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INVITE_DAYS, MEMBER_INVITES } from '../data/social.ts';
import { DAY, reason, SITE, socialWorld, value } from './social-fixtures.ts';

const newcomer = (n = 1) => ({ name: `New ${n}`, email: `new${n}@firm.my`, handle: `new_${n}` });

test('a team invite lets one person in, by its link, and then says it was used', async () => {
  const w = socialWorld();
  const host = await w.host;
  const { token, invite } = value(w.invites.inviteByEmail(host.id, { email: 'siti@firm.my', name: 'Siti' }));
  assert.equal(invite.state, 'live');
  assert.deepEqual(w.invites.look(token), { state: 'live', kind: 'team', email: 'siti@firm.my', name: 'Siti', inviter: { name: 'Host', handle: null } });

  const { memberId } = value(w.invites.join(token, { name: 'Siti', email: 'siti@firm.my', handle: 'siti' }));
  assert.deepEqual(w.profiles.entry(memberId), { via: 'team', inviterId: null });
  assert.equal(w.club.member(memberId)?.joinedVia, 'social', 'a Social newcomer is not a club member');
  assert.equal(w.club.member(memberId)?.status, 'invited', 'they set a password next');

  assert.equal(reason(w.invites.join(token, newcomer())), 'dead', 'a used link lets nobody else in');
  assert.deepEqual(w.invites.look(token), { state: 'used' });
  assert.equal(w.club.members({ limit: 10, offset: 0 }).items.some((m) => m.email === 'new1@firm.my'), false, 'a refused join saves nothing');
  assert.equal(reason(w.invites.inviteByEmail(host.id, { email: 'SITI@firm.my', name: null })), 'on-social', 'someone on Social needs no invite');
});

test('a newer team invite to the same address replaces the older one', async () => {
  const w = socialWorld();
  const host = await w.host;
  const first = value(w.invites.inviteByEmail(host.id, { email: 'siti@firm.my', name: 'Siti' })).token;
  const second = value(w.invites.inviteByEmail(host.id, { email: 'siti@firm.my', name: 'Siti' })).token;
  assert.deepEqual(w.invites.look(first), { state: 'revoked' });
  assert.equal(w.invites.look(second).state, 'live');
  value(w.invites.withdraw(w.invites.teamInvites()[0]?.id ?? 0));
  assert.equal(reason(w.invites.join(second, newcomer())), 'dead', 'a withdrawn link lets nobody in');
});

test('an invite runs out after its days, and an unknown link is dead too', async () => {
  const w = socialWorld();
  const host = await w.host;
  const { token } = value(w.invites.inviteByEmail(host.id, { email: 'siti@firm.my', name: null }));
  w.later(INVITE_DAYS * DAY - 60_000);
  assert.equal(w.invites.look(token).state, 'live');
  w.later(60_000);
  assert.deepEqual(w.invites.look(token), { state: 'expired' });
  assert.equal(reason(w.invites.join(token, newcomer())), 'dead');
  assert.deepEqual(w.invites.look('made-up'), { state: 'unknown' });
  assert.equal(reason(w.invites.join('made-up', newcomer())), 'dead');
});

test('a member needs a ticked credential to invite', async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  assert.deepEqual(w.invites.allowance(aina.id), { eligible: false, left: MEMBER_INVITES });
  assert.equal(reason(w.invites.create(aina.id)), 'no-tick');
  const proven = value(w.claims.addAccount(aina.id, 'LinkedIn', 'aina'));
  value(w.claims.decideAccount(proven.id, (await w.host).id, { verdict: 'approve' }));
  assert.equal(reason(w.invites.create(aina.id)), 'no-tick', 'a proven account is not a credential');
  const body = value(w.claims.addClaim(aina.id, { kind: 'body', bodyId: 'acca', status: 'Student', reference: '1', otherName: null, evidenceKey: null }));
  value(w.claims.decideClaim(body.id, (await w.host).id, { verdict: 'approve' }));
  assert.equal(w.invites.allowance(aina.id).eligible, true, 'any ticked credential will do, a student one too');
  value(w.invites.create(aina.id));
});

test('a member has three invites: used ones are spent, revoked and expired ones come back', async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  await w.seal(aina.id, 'aina');
  const links = [1, 2, 3].map(() => value(w.invites.create(aina.id)));
  assert.equal(reason(w.invites.create(aina.id)), 'none-left', 'no fourth while three are out');
  assert.equal(w.invites.allowance(aina.id).left, 0);

  const [used, revoked] = links;
  assert.ok(used && revoked);
  const { memberId: abu } = value(w.invites.join(used.token, { name: 'Abu', email: 'abu@firm.my', handle: 'abu' }));
  assert.deepEqual(w.profiles.entry(abu), { via: 'member', inviterId: aina.id });
  assert.equal(reason(w.invites.revoke(aina.id, used.invite.id)), 'used', 'a used invite cannot be taken back');
  value(w.invites.revoke(aina.id, revoked.invite.id));
  assert.equal(reason(w.invites.join(revoked.token, newcomer())), 'dead');
  assert.equal(w.invites.allowance(aina.id).left, 1, 'revoking returns it');
  assert.equal(reason(w.invites.revoke((await w.host).id, links[2]?.invite.id ?? 0)), 'not-found', 'only the inviter revokes');

  w.later(INVITE_DAYS * DAY);
  assert.equal(w.invites.allowance(aina.id).left, MEMBER_INVITES - 1, 'expired ones come back; the used one stays spent');
  assert.deepEqual(
    w.invites.mine(aina.id).map((i) => i.state),
    ['expired', 'revoked', 'used'],
  );
});

test('a profile says who invited it while the inviter is public', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  await w.seal(aina.id, 'aina');
  const { memberId: abu } = value(w.invites.join(value(w.invites.create(aina.id)).token, { name: 'Abu', email: 'abu@firm.my', handle: 'abu' }));
  assert.deepEqual(w.profiles.invitedBy(abu), { handle: 'aina', name: 'Aina' });
  assert.equal(w.invites.mine(aina.id)[0]?.usedBy, null, 'nobody is named before their profile is public');

  const team = value(w.invites.inviteByEmail(host.id, { email: 'siti@firm.my', name: null })).token;
  const { memberId: siti } = value(w.invites.join(team, { name: 'Siti', email: 'siti@firm.my', handle: 'siti' }));
  assert.equal(w.profiles.invitedBy(siti), null, 'a team invite names nobody');

  value(w.club.suspendMember(host.id, aina.id, SITE));
  assert.equal(w.profiles.invitedBy(abu), null, 'a paused inviter is not shown');
  value(w.club.removeMember(host.id, aina.id, SITE));
  assert.deepEqual(w.profiles.entry(abu), { via: 'member', inviterId: null }, 'deleting the inviter keeps how they joined');
});

test('a paused member’s invites stop working', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  await w.seal(aina.id, 'aina');
  const { token } = value(w.invites.create(aina.id));
  value(w.club.suspendMember(host.id, aina.id, SITE));
  assert.deepEqual(w.invites.look(token), { state: 'revoked' });
  assert.equal(reason(w.invites.join(token, newcomer())), 'dead');
});

test('a signed-in member uses a link to get in, once', async () => {
  const w = socialWorld();
  const host = await w.host;
  /* A club member the team brings over, who has an account but no way into Social recorded yet. */
  w.club.recordJoinRequest({ name: 'Club Member', email: 'club@firm.my', stage: 'I run a practice' });
  const accepted = value(w.club.inviteFromRequest(w.club.joinRequests()[0]?.id ?? 0));
  assert.ok(accepted.kind === 'link');
  const clubMember = accepted.link.member.id;
  const { token } = value(w.invites.inviteByEmail(host.id, { email: 'club@firm.my', name: 'Club Member' }));
  assert.equal(reason(w.invites.join(token, { name: 'Club Member', email: 'club@firm.my', handle: 'clubby' })), 'email-taken');
  value(w.invites.redeem(clubMember, token));
  assert.deepEqual(w.profiles.entry(clubMember), { via: 'team', inviterId: null });
  value(w.profiles.claimHandle(clubMember, 'clubby'));
  assert.deepEqual(w.profiles.entry(clubMember), { via: 'team', inviterId: null }, 'claiming the handle keeps the invite as the way in');

  const second = value(w.invites.inviteByEmail(host.id, { email: 'other@firm.my', name: null })).token;
  assert.equal(reason(w.invites.redeem(clubMember, second)), 'already-in');
  assert.equal(w.invites.look(second).state, 'live', 'a refused use does not spend the link');
});

test('housekeeping deletes long-dead unused links and keeps used and live ones', async () => {
  const w = socialWorld();
  const host = await w.host;
  const used = value(w.invites.inviteByEmail(host.id, { email: 'used@firm.my', name: null })).token;
  value(w.invites.join(used, { name: 'Used', email: 'used@firm.my', handle: 'used' }));
  value(w.invites.inviteByEmail(host.id, { email: 'expires@firm.my', name: null }));
  w.later(INVITE_DAYS * DAY);
  const live = value(w.invites.inviteByEmail(host.id, { email: 'live@firm.my', name: null })).token;
  assert.equal(w.invites.prune(), 0, 'an expired link still says so for a while');
  w.later(10 * DAY);
  assert.equal(w.invites.look(live).state, 'live');
  w.later(21 * DAY);
  assert.equal(w.invites.prune(), 1);
  assert.deepEqual(w.invites.look(used), { state: 'used' }, 'used links stay: they count against an allowance');
  assert.deepEqual(
    w.invites.teamInvites().map((i) => i.email),
    ['live@firm.my', 'used@firm.my'],
  );
});

test('the abandoned sign-up job spares unused invites and pending requests, and returns an invite its newcomer abandoned', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  await w.seal(aina.id, 'aina');
  const unused = value(w.invites.create(aina.id)).token;
  const abandoned = value(w.invites.create(aina.id)).token;
  value(w.invites.join(abandoned, { name: 'Gone', email: 'gone@firm.my', handle: 'gone' }));
  const teamUnused = value(w.invites.inviteByEmail(host.id, { email: 'later@firm.my', name: null })).token;
  value(w.requests.request({ name: 'Waiting', email: 'waiting@firm.my', about: 'Audit senior, posts on LinkedIn', link: null }));
  assert.equal(w.invites.allowance(aina.id).left, MEMBER_INVITES - 2);

  w.later(13 * DAY);
  assert.equal(w.profiles.pruneAbandoned(), 0);
  w.later(2 * DAY);
  assert.equal(w.profiles.pruneAbandoned(), 1);
  assert.equal(w.requests.queue().length, 1, 'a pending request is not a member, so it stays');
  assert.equal(w.invites.mine(aina.id).length, 1, 'the unused invite stays');
  assert.notEqual(w.invites.look(unused).state, 'unknown');
  assert.notEqual(w.invites.look(teamUnused).state, 'unknown');
  assert.equal(w.invites.allowance(aina.id).left, MEMBER_INVITES, 'the abandoned one goes back, and the unused one has run out');
});
