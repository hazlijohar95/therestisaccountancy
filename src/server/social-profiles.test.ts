import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import { createSocialProfiles, sealOf, trackOf, type ProfileFields } from './social-profiles.ts';

const PASSWORD = 'correct horse battery';

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

const fields = (changes: Partial<ProfileFields> = {}): ProfileFields => ({
  headline: 'Tax agent. Explains Malaysian tax one case at a time.',
  sector: 'Practice',
  city: 'Penang',
  jurisdictions: ['MY'],
  topics: ['Tax'],
  creator: false,
  listed: true,
  ...changes,
});

const world = () => {
  const now = () => new Date('2026-11-26T02:00:00Z');
  const db = openDatabase(':memory:');
  const club = createClub(db, now);
  const social = createSocialProfiles(db, now);

  /** Signs up on the social site and sets a password from the emailed link, as a person would. */
  const joined = async (name: string, email: string, handle: string) => {
    const { memberId } = value(social.signUp({ name, email, handle }));
    const accepted = await club.setPasswordFromLink(value(club.newLink(memberId)).token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  return { db, club, social, joined };
};

test('signing up makes an invited social member with a handle, public only once they set a password', async () => {
  const w = world();
  const { memberId } = value(w.social.signUp({ name: 'Priya Nair', email: 'priya@tax.my', handle: '@PriyaTaxes' }));

  const member = w.club.member(memberId);
  assert.equal(member?.status, 'invited');
  assert.equal(member?.joinedVia, 'social');
  assert.equal(w.social.ownProfile(memberId)?.handle, 'priyataxes', 'stored lowercase, without the @');
  assert.equal(w.social.profile('priyataxes'), null, 'nobody sees a profile whose email is not proven yet');
  assert.deepEqual(w.social.list(), []);

  const link = value(w.club.newLink(memberId));
  assert.equal(link.purpose, 'welcome', 'the existing welcome link sets their first password');
  await w.club.setPasswordFromLink(link.token, PASSWORD);

  const shown = w.social.profile('PriyaTaxes');
  assert.equal(shown?.name, 'Priya Nair');
  assert.equal(shown?.track, 'field', 'no claims yet');
  assert.equal(shown?.sealed, false);
  assert.deepEqual(w.social.list().map((e) => [e.profile.handle, e.points]), [['priyataxes', 0]]);
});

test('a club member keeps joined_via club and claims a handle from the social site', async () => {
  const w = world();
  const admin = await w.club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });
  assert.equal(admin.joinedVia, 'club');
  assert.equal(w.social.ownProfile(admin.id), null);

  const profile = value(w.social.claimHandle(admin.id, 'thehost'));
  assert.equal(profile.handle, 'thehost');
  assert.equal(reason(w.social.claimHandle(admin.id, 'another')), 'already-claimed');
});

test('handles are 3 to 30 of a-z, 0-9 and _, unique, and never a reserved word', async () => {
  const w = world();
  await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  const signUp = (handle: string, email = 'new@firm.my') => reason(w.social.signUp({ name: 'New Person', email, handle }));

  assert.equal(signUp('AINA'), 'handle-taken', 'case does not make a handle new');
  assert.equal(signUp('ab'), 'handle-invalid');
  assert.equal(signUp('a'.repeat(31)), 'handle-invalid');
  assert.equal(signUp('aina.rahman'), 'handle-invalid');
  assert.equal(signUp('ainá'), 'handle-invalid');
  assert.equal(signUp('admin'), 'handle-reserved');
  assert.equal(signUp('support'), 'handle-reserved');
  assert.equal(signUp('a'.repeat(30)), null);
  assert.equal(signUp('tax_with_tan_2', 'tan@firm.my'), null);
});

test('a refused sign-up saves nothing, and an email that has an account is turned away', async () => {
  const w = world();
  await w.joined('Aina Rahman', 'aina@firm.my', 'aina');

  assert.equal(reason(w.social.signUp({ name: 'Aina Again', email: 'AINA@firm.my', handle: 'aina2' })), 'email-taken');
  assert.equal(reason(w.social.signUp({ name: 'Someone', email: 'someone@firm.my', handle: 'aina' })), 'handle-taken');
  assert.equal(w.club.members({ limit: 10, offset: 0 }).total, 1, 'no member was left behind without a profile');
  assert.equal(reason(w.social.signUp({ name: 'Someone', email: 'someone@firm.my', handle: 'someone' })), null, 'the email is free to try again');
});

test('the member edits their profile, and The List shows only listed profiles that match', async () => {
  const w = world();
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const aina = await w.joined('Aina Rahman', 'aina@firm.my', 'aina');

  const saved = w.social.update(priya.id, fields({ topics: ['Tax', 'Audit'], jurisdictions: ['SG', 'MY'] }));
  assert.deepEqual(saved?.topics, ['Audit', 'Tax'], 'kept in the registry order');
  assert.deepEqual(saved?.jurisdictions, ['MY', 'SG']);
  assert.equal(saved?.sector, 'Practice');
  w.social.update(aina.id, fields({ topics: ['Audit'], creator: true }));

  assert.deepEqual(w.social.list().map((e) => e.profile.handle), ['priyataxes', 'aina'], 'equal points: the longest here first');
  assert.deepEqual(w.social.list({ topic: 'Tax' }).map((e) => e.profile.handle), ['priyataxes']);
  assert.deepEqual(w.social.list({ track: 'creator' }).map((e) => e.profile.handle), ['aina'], 'the creator flair is their choice');

  w.social.update(priya.id, fields({ listed: false }));
  assert.deepEqual(w.social.list().map((e) => e.profile.handle), ['aina']);
  assert.equal(w.social.profile('priyataxes')?.listed, false, 'off The List, still reachable by handle');
  assert.equal(w.social.update(999, fields()), null, 'no profile, nothing saved');
});

test('a suspended member leaves The List and their profile goes dark', async () => {
  const w = world();
  const admin = await w.club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });
  const aina = await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  value(w.club.suspendMember(admin.id, aina.id));
  assert.equal(w.social.profile('aina'), null);
  assert.deepEqual(w.social.list(), []);
});

test('follows: once each, never yourself, and counted only between people the public can see', async () => {
  const w = world();
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const aina = await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  const pending = value(w.social.signUp({ name: 'Not Yet', email: 'notyet@firm.my', handle: 'notyet' }));

  assert.equal(value(w.social.follow(aina.id, 'priyataxes')).memberId, priya.id);
  value(w.social.follow(aina.id, '@PriyaTaxes'));
  assert.equal(w.social.isFollowing(aina.id, priya.id), true);
  assert.deepEqual(w.social.followCounts(priya.id), { followers: 1, following: 0 });
  assert.deepEqual(w.social.followCounts(aina.id), { followers: 0, following: 1 });

  assert.equal(reason(w.social.follow(aina.id, 'aina')), 'self');
  assert.equal(reason(w.social.follow(aina.id, 'notyet')), 'not-found', 'an unproven profile cannot be followed');
  assert.equal(reason(w.social.follow(aina.id, 'nobody')), 'not-found');
  w.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(pending.memberId, priya.id, '2026-11-26T02:00:00Z');
  assert.deepEqual(w.social.followCounts(priya.id), { followers: 1, following: 0 }, 'an unproven follower is not counted');

  assert.equal(w.social.unfollow(aina.id, 'priyataxes'), true);
  assert.equal(w.social.unfollow(aina.id, 'priyataxes'), false);
  assert.equal(w.social.isFollowing(aina.id, priya.id), false);
});

test('track and seal come from ticked claims: credentials outrank the creator flair', () => {
  assert.equal(trackOf([], false), 'field');
  assert.equal(trackOf([], true), 'creator');
  assert.equal(sealOf([]), false);

  const account = { kind: 'account', state: 'ticked', track: null } as const;
  const student = { kind: 'body', state: 'ticked', track: 'training' } as const;
  const fellow = { kind: 'body', state: 'ticked', track: 'qualified' } as const;
  assert.equal(trackOf([student], true), 'training');
  assert.equal(trackOf([student, fellow], false), 'qualified');
  assert.equal(trackOf([{ ...fellow, state: 'lapsed' }], false), 'field', 'a lapsed credential no longer counts');
  assert.equal(sealOf([account]), false, 'an account alone is not enough');
  assert.equal(sealOf([fellow]), false, 'a credential alone is not enough');
  assert.equal(sealOf([account, fellow]), true);
  assert.equal(sealOf([account, { ...fellow, state: 'pending' }]), false);
});
