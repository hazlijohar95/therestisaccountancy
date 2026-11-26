import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { migrate, SCHEMA_VERSION } from './db.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import { at, DAY, SITE, socialWorld } from './social-fixtures.ts';
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
    const { memberId } = value(social.signUp({ name, email, handle }, { via: 'team' }));
    const accepted = await club.setPasswordFromLink(value(club.newLink(memberId)).token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  return { db, club, social, joined };
};

test('signing up makes an invited social member with a handle, public only once they set a password', async () => {
  const w = world();
  const { memberId } = value(w.social.signUp({ name: 'Priya Nair', email: 'priya@tax.my', handle: '@PriyaTaxes' }, { via: 'team' }));

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

test('Social is invite-only: only the club, or something that let them in, lets a member claim a handle', async () => {
  const w = world();
  const admin = await w.club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });
  value(w.social.claimHandle(admin.id, 'thehost'));
  assert.deepEqual(w.social.entry(admin.id), { via: 'club', inviterId: null }, 'a club member is let in as they claim a handle');

  const { lastInsertRowid: stranger } = w.db.prepare(`INSERT INTO members (email, name, joined_via) VALUES ('stranger@firm.my', 'Stranger', 'social')`).run();
  assert.equal(w.social.mayClaim(stranger), false);
  assert.equal(reason(w.social.claimHandle(stranger, 'stranger')), 'not-invited');
  assert.equal(w.social.entry(stranger), null, 'a refused claim lets nobody in');
  w.db.prepare(`UPDATE members SET club_approved_at = '2026-11-01T00:00:00Z' WHERE id = ?`).run(stranger);
  assert.equal(w.social.mayClaim(stranger), true, 'a member the club approved needs no invite');
  value(w.social.claimHandle(stranger, 'stranger'));
  assert.deepEqual(w.social.entry(stranger), { via: 'club', inviterId: null });
});

test('the schema refuses a profile nobody let in, and an inviter on anything but a member invite', async () => {
  const w = world();
  const { lastInsertRowid: id } = w.db.prepare(`INSERT INTO members (email, name, joined_via) VALUES ('x@firm.my', 'X', 'social')`).run();
  assert.throws(() => w.db.prepare(`INSERT INTO profiles (member_id, handle, created_at, updated_at) VALUES (?, 'sneaky', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).run(id), /needs an entry/);
  assert.throws(() => w.db.prepare(`INSERT INTO social_entries (member_id, joined_via, inviter_id, created_at) VALUES (?, 'team', ?, '2026-01-01T00:00:00Z')`).run(id, id));
  assert.throws(() => w.db.prepare(`INSERT INTO social_entries (member_id, joined_via, created_at) VALUES (?, 'walked-in', '2026-01-01T00:00:00Z')`).run(id));
});

test('accounts that joined before invites keep working and are recorded as open', async () => {
  const w = socialWorld();
  const owner = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  value(w.profiles.claimHandle(owner.id, 'owner'));
  /* Back to the schema before invites, with profiles made the old way, then upgrade again. */
  w.db.exec('DROP TABLE sign_ins; DROP TABLE social_requests; DROP TABLE social_invites; DROP TRIGGER profiles_need_an_entry; DROP TABLE social_entries;');
  w.db.prepare('DELETE FROM schema_version WHERE version >= ?').run(SCHEMA_VERSION - 1);
  w.db.prepare(`INSERT INTO members (email, name, joined_via, password_hash) VALUES ('old@firm.my', 'Old Timer', 'social', 'x')`).run();
  w.db.prepare(`INSERT INTO profiles (member_id, handle, created_at, updated_at) SELECT id, 'oldtimer', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z' FROM members WHERE email = 'old@firm.my'`).run();
  migrate(w.db);

  const old = w.profiles.profile('oldtimer');
  assert.ok(old);
  for (const id of [owner.id, aina.id, old.memberId]) assert.deepEqual(w.profiles.entry(id), { via: 'open', inviterId: null }, `member ${id} joined openly`);
  assert.equal(w.profiles.ownProfile(owner.id)?.handle, 'owner', "the owner's profile is untouched");
  assert.equal(w.profiles.profile('aina')?.name, 'Aina');
  const followed = w.profiles.follow(aina.id, 'oldtimer');
  assert.ok(followed.ok, 'old accounts still act as before');
});

test('handles are 3 to 30 of a-z, 0-9 and _, unique, and never a reserved word', async () => {
  const w = world();
  await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  const signUp = (handle: string, email = 'new@firm.my') => reason(w.social.signUp({ name: 'New Person', email, handle }, { via: 'team' }));

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

  assert.equal(reason(w.social.signUp({ name: 'Aina Again', email: 'AINA@firm.my', handle: 'aina2' }, { via: 'team' })), 'email-taken');
  assert.equal(reason(w.social.signUp({ name: 'Someone', email: 'someone@firm.my', handle: 'aina' }, { via: 'team' })), 'handle-taken');
  assert.equal(w.club.members({ limit: 10, offset: 0 }).total, 1, 'no member was left behind without a profile');
  assert.equal(reason(w.social.signUp({ name: 'Someone', email: 'someone@firm.my', handle: 'someone' }, { via: 'team' })), null, 'the email is free to try again');
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
  value(w.club.suspendMember(admin.id, aina.id, SITE));
  assert.equal(w.social.profile('aina'), null);
  assert.deepEqual(w.social.list(), []);
});

test('follows: once each, never yourself, and counted only between people the public can see', async () => {
  const w = world();
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const aina = await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  const pending = value(w.social.signUp({ name: 'Not Yet', email: 'notyet@firm.my', handle: 'notyet' }, { via: 'team' }));

  assert.equal(value(w.social.follow(aina.id, 'priyataxes')).memberId, priya.id);
  value(w.social.follow(aina.id, '@PriyaTaxes'));
  assert.equal(w.social.page('priyataxes', aina.id)?.following, true);
  assert.deepEqual(w.social.page('priyataxes', null)?.counts, { followers: 1, following: 0 });
  assert.deepEqual(w.social.page('aina', null)?.counts, { followers: 0, following: 1 });

  assert.equal(reason(w.social.follow(aina.id, 'aina')), 'self');
  assert.equal(reason(w.social.follow(aina.id, 'notyet')), 'not-found', 'an unproven profile cannot be followed');
  assert.equal(reason(w.social.follow(aina.id, 'nobody')), 'not-found');
  w.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(pending.memberId, priya.id, '2026-11-26T02:00:00Z');
  assert.deepEqual(w.social.page('priyataxes', null)?.counts, { followers: 1, following: 0 }, 'an unproven follower is not counted');

  assert.equal(w.social.unfollow(aina.id, 'priyataxes'), true);
  assert.equal(w.social.unfollow(aina.id, 'priyataxes'), false);
  assert.equal(w.social.page('priyataxes', aina.id)?.following, false);
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

test('sign-ups that never set a password go after 14 days, handle and all; nobody else is touched', async () => {
  const w = socialWorld();
  const host = await w.host;
  const set = await w.joined('Aina', 'aina@firm.my', 'aina');
  const { memberId: gone } = value(w.profiles.signUp({ name: 'Gone', email: 'gone@firm.my', handle: 'gone' }, { via: 'team' }));
  const { memberId: accepted } = value(w.profiles.signUp({ name: 'Accepted', email: 'accepted@firm.my', handle: 'accepted' }, { via: 'team' }));
  const { memberId: paused } = value(w.profiles.signUp({ name: 'Paused', email: 'paused@firm.my', handle: 'paused' }, { via: 'team' }));
  value(w.club.suspendMember(host.id, paused, SITE));
  w.club.recordJoinRequest({ name: 'Accepted', email: 'accepted@firm.my', stage: 'I run a practice' });
  value(w.club.inviteFromRequest(w.club.joinRequests()[0]?.id ?? 0));
  w.club.recordJoinRequest({ name: 'Club invite', email: 'club@firm.my', stage: 'Student' });
  const invitation = value(w.club.inviteFromRequest(w.club.joinRequests().find((r) => r.email === 'club@firm.my')?.id ?? 0));
  const clubInvite = invitation.kind === 'link' ? invitation.link.member.id : invitation.member.id;
  value(w.nominations.nominate(set.id, { platform: 'YouTube', handle: 'taxwithtan', topics: ['Tax'], whyUrl: null }));
  const { token } = value(w.nominations.invite(w.nominations.queue().pending[0]?.id ?? 0, host.id));
  const { memberId: nominee } = value(w.nominations.join(token, { name: 'Tan', email: 'tan@tax.my', handle: 'taxwithtan' }));

  w.later(13 * DAY);
  assert.equal(w.profiles.pruneAbandoned(), 0, 'thirteen days is not enough');
  w.later(2 * DAY);
  assert.equal(w.profiles.pruneAbandoned(), 2);
  assert.equal(w.profiles.pruneAbandoned(), 0, 'safe to rerun');
  assert.equal(w.club.member(gone), null);
  assert.equal(w.club.member(nominee), null);
  for (const kept of [set.id, accepted, paused, clubInvite, host.id]) assert.ok(w.club.member(kept), `member ${kept} stays`);
  value(w.profiles.signUp({ name: 'Someone else', email: 'else@firm.my', handle: 'gone' }, { via: 'team' }));
  assert.equal(w.nominations.queue().pending[0]?.handle, 'taxwithtan', 'the claimed invite goes back to the team to send again');
});

test('the setup checklist follows what the member has done', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  assert.deepEqual(w.profiles.checklist(aina.id), { ticked: false, headline: false, casebook: false, answered: false, badge: false });
  await w.seal(aina.id, 'aina-rahman');
  w.profiles.update(aina.id, { headline: 'Audit partner.', sector: null, city: '', jurisdictions: [], topics: [], creator: false, listed: true });
  value(w.casebook.add(aina.id, { service: 'Audit', industry: 'Retail', band: 'Under RM5m', framework: 'MPERS', year: '2024', role: 'Partner', areas: [], note: '', cosigner: null }));
  value(
    w.problems.create(host.id, { number: 1, tag: 'Audit', jurisdiction: 'MY', title: 'T', scenario: ['a', 'b'], ask: 'Q', options: ['x', 'y'], opensAt: at(w.now()), closesAt: at(new Date(w.now().getTime() + DAY)) }),
  );
  value(w.problems.answer(aina.id, 1, { pick: 'A', reasoning: '' }));
  w.profiles.badgeCopied(aina.id);
  assert.deepEqual(w.profiles.checklist(aina.id), { ticked: true, headline: true, casebook: true, answered: true, badge: true });
  assert.equal(w.profiles.credential(aina.id), 'ACCA · Member');
});

test("a member's page shows the same profile to everyone, and what only the owner or a sealed reader may do", async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu Musa', 'abu@firm.my', 'abu');
  const siti = await w.club.ensureAdmin({ email: 'siti@club.test', name: 'Siti', password: 'correct horse battery' });
  await w.seal(aina.id, 'aina-r');
  await w.seal(abu.id, 'abu-m');
  const experience = value(w.claims.addClaim(aina.id, { kind: 'experience', text: 'Six years in audit' }));
  value(w.claims.vouch(abu.id, experience.id));
  value(w.profiles.follow(abu.id, 'aina'));
  value(w.floor.post(aina.id, { room: 'tax-my', jurisdiction: 'MY', title: 'Does a dormant Sdn Bhd still need an audit?', body: 'Asking for a client.' }));
  const ainasItem = value(w.shelf.add(aina.id, { kind: 'Template', title: 'Audit checklist', url: 'https://example.com/checklist' }));
  const abusItem = value(w.shelf.add(abu.id, { kind: 'Template', title: 'Engagement letter', url: 'https://example.com/letter' }));
  value(w.shelf.save(abu.id, ainasItem.id));
  value(w.shelf.save(aina.id, abusItem.id));

  assert.equal(w.profiles.page('nobody', abu.id), null);

  const seen = (viewerId: number | null) => {
    const page = w.profiles.page('AINA', viewerId);
    assert.ok(page);
    return {
      handle: page.profile.handle,
      own: page.own,
      canVouch: page.canVouch,
      following: page.following,
      counts: page.counts,
      invitedBy: page.invitedBy,
      accounts: page.ledger.accounts.map((a) => a.handle),
      claims: page.ledger.claims.map((c) => [c.label, c.review.state, c.vouches, c.vouchedByViewer]),
      roles: page.roles,
      answers: page.record.answers,
      entries: page.heat.entries,
      posts: page.posts.map((p) => p.title),
      shelf: page.shelf.map((i) => [i.title, i.saves, i.savedByViewer]),
      saved: page.saved.map((i) => i.title),
      checklist: page.checklist,
    };
  };
  const everyone = {
    handle: 'aina',
    own: false,
    canVouch: false,
    following: false,
    counts: { followers: 1, following: 0 },
    invitedBy: null,
    accounts: ['aina-r'],
    claims: [
      ['ACCA · Member', 'ticked', 0, false],
      ['Six years in audit', 'pending', 1, false],
    ],
    roles: [],
    answers: 0,
    entries: 0,
    posts: ['Does a dormant Sdn Bhd still need an audit?'],
    shelf: [['Audit checklist', 1, false]],
    saved: [],
    checklist: null,
  };
  assert.deepEqual(seen(null), everyone, 'signed out');
  assert.deepEqual(seen(siti.id), everyone, 'signed in without a handle');
  assert.deepEqual(
    seen(abu.id),
    {
      ...everyone,
      canVouch: true,
      following: true,
      claims: [
        ['ACCA · Member', 'ticked', 0, false],
        ['Six years in audit', 'pending', 1, true],
      ],
      shelf: [['Audit checklist', 1, true]],
    },
    'a sealed reader who follows and vouched',
  );
  assert.deepEqual(
    seen(aina.id),
    { ...everyone, own: true, saved: ['Engagement letter'], checklist: { ticked: true, headline: false, casebook: false, answered: false, badge: false } },
    'the owner',
  );
});

function saveProfile(w: ReturnType<typeof socialWorld>, memberId: number, handle: string | null, changes: ProfileFields): string {
  if (!w.profiles.ownProfile(memberId)) {
    if (!handle) return 'no-handle';
    const claim = w.profiles.claimHandle(memberId, handle);
    if (!claim.ok) return claim.reason;
  }
  return w.profiles.update(memberId, changes)?.handle ?? 'not-saved';
}

test('saving a profile claims the handle first when there is none, and keeps the one there is', async () => {
  const w = socialWorld();
  await w.joined('Aina', 'aina@firm.my', 'aina');
  const aina = w.profiles.profile('aina');
  const siti = await w.club.ensureAdmin({ email: 'siti@club.test', name: 'Siti', password: 'correct horse battery' });
  assert.ok(aina);

  assert.equal(saveProfile(w, siti.id, null, fields()), 'no-handle');
  assert.equal(saveProfile(w, siti.id, 'aina', fields()), 'handle-taken');
  assert.equal(w.profiles.ownProfile(siti.id), null, 'nothing is saved when the handle is refused');
  assert.equal(saveProfile(w, siti.id, '@Siti', fields({ headline: 'Club host.' })), 'siti');
  assert.equal(w.profiles.ownProfile(siti.id)?.headline, 'Club host.');
  assert.equal(saveProfile(w, aina.memberId, 'somethingelse', fields({ city: 'Ipoh' })), 'aina', 'a handle, once claimed, stays');
  assert.equal(w.profiles.ownProfile(aina.memberId)?.city, 'Ipoh');
});
