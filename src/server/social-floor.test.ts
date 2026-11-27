import assert from 'node:assert/strict';
import { test } from 'node:test';
import { terms } from '../data/membership.ts';
import { migrate, SCHEMA_VERSION } from './db.ts';
import type { Letter } from './letters.ts';
import { REPLY_NOTICE_GAP_MS } from './mailings.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import type { PostDraft } from './social-floor.ts';
import { socialWorld } from './social-fixtures.ts';
import { sealedSql } from './social-profiles.ts';
import { createStore } from './store.ts';

const SITE = 'https://therestisaccountancy.com/';

const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;
const DAY = 86_400_000;

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

const draft = (changes: Partial<PostDraft> = {}): PostDraft => ({
  room: 'tax-my',
  jurisdiction: 'MY',
  title: 'Does a dormant Sdn Bhd still need an audit?',
  body: 'It has not traded since 2024.',
  ...changes,
});

const world = (version = SCHEMA_VERSION) => {
  let clock = new Date('2026-11-26T02:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:', version);
  const { club, billing, mailings, socialProfiles: profiles, socialClaims: claims, socialFloor: floor, socialNotifications: notifications } = createStore(db, now);
  const host = club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });

  const joined = async (name: string, email: string, handle: string) => {
    const { memberId } = value(profiles.signUp({ name, email, handle }, { via: 'team' }));
    const accepted = await club.setPasswordFromLink(value(club.newLink(memberId)).token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  /** A proven account and a ticked ACCA membership: the seal. */
  const seal = async (memberId: number, handle: string) => {
    const reviewer = (await host).id;
    const account = value(claims.addAccount(memberId, 'LinkedIn', handle));
    value(claims.decideAccount(account.id, reviewer, { verdict: 'approve' }));
    const body = value(claims.addClaim(memberId, { kind: 'body', bodyId: 'acca', status: 'Member', reference: '1', otherName: null, evidenceKey: null }));
    value(claims.decideClaim(body.id, reviewer, { verdict: 'approve' }));
    return account;
  };
  const licence = async (memberId: number) => {
    const ticked = value(claims.addClaim(memberId, { kind: 'licence', licence: 'Practising certificate', reference: 'PC1', until: '2027-12', evidenceKey: 'k' }));
    value(claims.decideClaim(ticked.id, (await host).id, { verdict: 'approve' }));
  };
  /** Club membership paid for a month or a year from now. */
  const pay = (memberId: number, term: 'month' | 'year') => {
    billing.opened(`p-${memberId}-${clock.getTime()}`, memberId, 'checkout', term, terms[term].sen);
    assert.ok(billing.paid(`p-${memberId}-${clock.getTime()}`, false));
  };
  /** A member the club accepted from a join request, with a password set and no Social entry or handle. */
  const clubJoined = async (name: string, email: string) => {
    club.recordJoinRequest({ name, email, stage: 'I run a practice' });
    const invited = club.inviteFromRequest(club.joinRequests({ decided: false }).find((r) => r.email === email)?.id ?? 0);
    assert.ok(invited.ok && invited.value.kind === 'link');
    const accepted = await club.setPasswordFromLink(invited.value.link.token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  const feed = (viewerId: number | null, changes: Partial<Parameters<typeof floor.feed>[1]> = {}) => floor.feed(viewerId, { room: null, filter: 'all', offset: 0, ...changes });
  const titles = (viewerId: number | null, changes: Partial<Parameters<typeof floor.feed>[1]> = {}) => feed(viewerId, changes).posts.map((p) => p.title);
  return { db, club, billing, mailings, profiles, claims, floor, notifications, host, joined, clubJoined, seal, licence, pay, feed, titles, later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

const to = (letters: readonly Letter[]) => letters.map((letter) => letter.to);

test('posting needs a handle, and the practitioners’ room is only for ticked licences', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const clubOnly = await w.host;

  assert.equal(reason(w.floor.post(clubOnly.id, draft())), 'no-handle');
  assert.equal(reason(w.floor.post(aina.id, draft({ room: 'practice' }))), 'needs-licence');
  await w.licence(priya.id);
  const shop = value(w.floor.post(priya.id, draft({ room: 'practice', title: 'Fees for a first-year audit client' })));
  value(w.floor.post(aina.id, draft()));

  assert.deepEqual(w.titles(aina.id), ['Does a dormant Sdn Bhd still need an audit?'], 'the open feed leaves the room out');
  assert.deepEqual(w.titles(null), ['Does a dormant Sdn Bhd still need an audit?']);
  assert.equal(w.feed(aina.id, { room: 'practice' }).locked, 'licensed');
  assert.deepEqual(w.feed(aina.id, { room: 'practice' }).posts, []);
  assert.equal(w.feed(aina.id).rooms.find((r) => r.id === 'practice')?.locked, 'licensed');
  assert.equal(w.floor.thread(aina.id, shop.id)?.state, 'locked');
  assert.deepEqual(w.floor.searchPosts(aina.id, 'fees'), []);
  assert.deepEqual(w.floor.recentPosts(aina.id, priya.id), [], 'nor does her profile');
  assert.equal(reason(w.floor.reply(aina.id, shop.id, { body: 'Charge more.', correction: false }, SITE)), 'not-found');

  assert.equal(w.titles(priya.id).length, 2, 'a ticked licence reads it');
  assert.equal(w.floor.recentPosts(priya.id, priya.id).length, 1);
  assert.equal(w.floor.thread(priya.id, shop.id)?.state, 'open');
  assert.equal(w.titles(clubOnly.id).length, 2, 'so does the team');
});

test('the feed filters by room, following, jurisdiction and ticked answers, and pages', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const siti = await w.joined('Siti', 'siti@firm.my', 'siti');
  await w.seal(siti.id, 'siti-audit');

  const mine = value(w.floor.post(aina.id, draft({ title: 'GST on imported services' })));
  w.later(MINUTE);
  value(w.floor.post(abu.id, draft({ room: 'careers', jurisdiction: 'SG', title: 'Moving from audit to FP&A' })));
  w.later(MINUTE);
  value(w.floor.post(abu.id, draft({ room: 'study', jurisdiction: 'Any', title: 'How to pass SBR first time' })));

  assert.deepEqual(w.titles(aina.id, { room: 'careers' }), ['Moving from audit to FP&A']);
  assert.deepEqual(w.titles(aina.id, { filter: 'SG' }), ['Moving from audit to FP&A']);
  assert.deepEqual(w.titles(aina.id, { filter: 'Any' }), ['How to pass SBR first time']);
  assert.deepEqual(w.titles(aina.id, { filter: 'following' }), []);
  assert.deepEqual(w.titles(null, { filter: 'following' }), []);
  value(w.profiles.follow(aina.id, 'abu'));
  assert.deepEqual(w.titles(aina.id, { filter: 'following' }), ['How to pass SBR first time', 'Moving from audit to FP&A']);
  assert.deepEqual(w.feed(aina.id).rooms.find((r) => r.id === 'careers')?.posts, 1);

  const fromAbu = value(w.floor.reply(abu.id, mine.id, { body: 'Service tax applies.', correction: false }, SITE));
  value(w.floor.accept(aina.id, fromAbu.id));
  assert.deepEqual(w.titles(aina.id, { filter: 'ticked' }), [], 'an answer from someone without the seal is not a ticked answer');
  const fromSiti = value(w.floor.reply(siti.id, mine.id, { body: 'Service tax at 8%, from March 2024.', correction: false }, SITE));
  value(w.floor.accept(aina.id, fromSiti.id));
  assert.deepEqual(w.titles(aina.id, { filter: 'ticked' }), ['GST on imported services']);

  for (let i = 0; i < 20; i++) value(w.floor.post(abu.id, draft({ title: `Question number ${i + 1}` })));
  const first = w.feed(aina.id);
  assert.equal(first.total, 23);
  assert.equal(first.posts.length, 20);
  assert.equal(w.feed(aina.id, { offset: 20 }).posts.length, 3);
});

test('an accepted answer from a sealed member shows their main credential, and only while it holds', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const siti = await w.joined('Siti', 'siti@firm.my', 'siti');
  const account = await w.seal(siti.id, 'siti-audit');
  await w.licence(siti.id);
  const post = value(w.floor.post(aina.id, draft()));
  const reply = value(w.floor.reply(siti.id, post.id, { body: 'Yes, unless it qualifies for the exemption.', correction: false }, SITE));

  assert.equal(reason(w.floor.accept(siti.id, reply.id)), 'not-yours');
  value(w.floor.accept(aina.id, reply.id));
  value(w.floor.accept(aina.id, reply.id));
  const thread = w.floor.thread(aina.id, post.id);
  assert.equal(thread?.state, 'open');
  if (thread?.state !== 'open') return;
  assert.deepEqual(thread.post.answer, { replyId: reply.id, credential: 'ACCA · Member' }, 'a qualifying body outranks a licence');
  assert.equal(thread.replies[0]?.accepted, true);

  assert.ok(w.claims.removeAccount(siti.id, account.id));
  const unsealed = w.floor.thread(aina.id, post.id);
  assert.equal(unsealed?.state === 'open' ? unsealed.post.answer : 'closed', null, 'losing the seal drops the line');

  await w.seal(siti.id, 'siti-audit-2');
  value(w.floor.removeReply(siti.id, reply.id));
  const removed = w.floor.thread(aina.id, post.id);
  assert.equal(removed?.state === 'open' ? removed.post.answer : 'closed', null, 'a removed reply is no answer');
});

test('a seal resting on a workplace answers as a ticked member, and the asker can take the answer back', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const dan = await w.joined('Dan', 'dan@firm.my', 'dan');
  const account = value(w.claims.addAccount(dan.id, 'X', 'dantan'));
  value(w.claims.decideAccount(account.id, (await w.host).id, { verdict: 'approve' }));
  value(w.claims.confirmWorkEmail(dan.id, value(w.claims.startWorkEmail(dan.id, 'dan@tanco.com.my')).token));
  const post = value(w.floor.post(aina.id, draft()));
  const reply = value(w.floor.reply(dan.id, post.id, { body: 'Yes.', correction: false }, SITE));
  value(w.floor.accept(aina.id, reply.id));
  const answered = w.floor.thread(aina.id, post.id);
  assert.deepEqual(answered?.state === 'open' && answered.post.answer, { replyId: reply.id, credential: 'member' });

  value(w.floor.unaccept(aina.id, reply.id));
  const taken = w.floor.thread(aina.id, post.id);
  assert.equal(taken?.state === 'open' ? taken.post.answer : 'closed', null);
  assert.equal(taken?.state === 'open' && taken.replies[0]?.accepted, false);
});

test('only a sealed member can mark a reply as a correction, and the post shows it', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const siti = await w.joined('Siti', 'siti@firm.my', 'siti');
  await w.seal(siti.id, 'siti-audit');
  const post = value(w.floor.post(aina.id, draft()));

  assert.equal(reason(w.floor.reply(abu.id, post.id, { body: 'That figure is wrong.', correction: true }, SITE)), 'no-seal');
  const fix = value(w.floor.reply(siti.id, post.id, { body: 'The threshold is RM500,000, not RM50,000.', correction: true }, SITE));
  const [card] = w.feed(abu.id).posts;
  assert.deepEqual(card?.correction, { replyId: fix.id });
  const thread = w.floor.thread(abu.id, post.id);
  assert.equal(thread?.state === 'open' && thread.replies[0]?.correction, true);
});

test('useful: once per member, never on your own words, and it toggles', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const post = value(w.floor.post(aina.id, draft()));
  const reply = value(w.floor.reply(abu.id, post.id, { body: 'It does.', correction: false }, SITE));

  assert.equal(reason(w.floor.markUseful(aina.id, 'post', post.id)), 'self');
  assert.deepEqual(value(w.floor.markUseful(abu.id, 'post', post.id)), { useful: 1 });
  assert.deepEqual(value(w.floor.markUseful(abu.id, 'post', post.id)), { useful: 1 }, 'marking again changes nothing');
  assert.deepEqual(value(w.floor.markUseful(aina.id, 'reply', reply.id)), { useful: 1 });
  assert.equal(w.feed(abu.id).posts[0]?.usefulByViewer, true);
  assert.equal(w.feed(aina.id).posts[0]?.usefulByViewer, false);
  assert.deepEqual(value(w.floor.unmarkUseful(abu.id, 'post', post.id)), { useful: 0 });
  assert.equal(reason(w.floor.markUseful(abu.id, 'post', 999)), 'not-found');
});

test('replies sort by useful marks or newest, with the accepted one first', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const siti = await w.joined('Siti', 'siti@firm.my', 'siti');
  const post = value(w.floor.post(aina.id, draft()));
  const first = value(w.floor.reply(abu.id, post.id, { body: 'First.', correction: false }, SITE));
  w.later(MINUTE);
  const second = value(w.floor.reply(siti.id, post.id, { body: 'Second.', correction: false }, SITE));
  w.later(MINUTE);
  const third = value(w.floor.reply(abu.id, post.id, { body: 'Third.', correction: false }, SITE));
  value(w.floor.markUseful(aina.id, 'reply', second.id));

  const order = (sort: 'top' | 'new') => {
    const view = w.floor.thread(aina.id, post.id, sort);
    return view?.state === 'open' ? view.replies.map((r) => r.id) : [];
  };
  assert.deepEqual(order('top'), [second.id, first.id, third.id]);
  assert.deepEqual(order('new'), [third.id, second.id, first.id]);
  value(w.floor.accept(aina.id, first.id));
  assert.deepEqual(order('new'), [first.id, third.id, second.id]);
  assert.equal(w.feed(aina.id).posts[0]?.replies, 3);
});

test('authors edit for fifteen minutes and delete their own; the team removes anything', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const host = await w.host;
  value(w.profiles.claimHandle(host.id, 'hazli'));
  const post = value(w.floor.post(aina.id, draft()));
  const reply = value(w.floor.reply(abu.id, post.id, { body: 'Yes.', correction: false }, SITE));

  assert.equal(w.feed(aina.id).posts[0]?.editable, true);
  assert.equal(w.feed(abu.id).posts[0]?.editable, false);
  assert.equal(reason(w.floor.editPost(abu.id, post.id, draft({ title: 'Hijacked title here' }))), 'not-yours');
  value(w.floor.editPost(aina.id, post.id, draft({ title: 'Does a dormant company need an audit?' })));
  assert.equal(w.feed(abu.id).posts[0]?.title, 'Does a dormant company need an audit?');
  assert.ok(w.feed(abu.id).posts[0]?.editedAt);
  assert.equal(reason(w.floor.editReply(aina.id, reply.id, 'Not mine.')), 'not-yours');
  value(w.floor.editReply(abu.id, reply.id, 'Yes, unless it is exempt.'));
  const edited = w.floor.thread(aina.id, post.id);
  assert.equal(edited?.state === 'open' && edited.replies[0]?.body, 'Yes, unless it is exempt.');
  assert.ok(edited?.state === 'open' && edited.replies[0]?.editedAt);
  w.later(15 * MINUTE);
  assert.equal(reason(w.floor.editPost(aina.id, post.id, draft())), 'too-late');
  assert.equal(reason(w.floor.editReply(abu.id, reply.id, 'No.')), 'too-late');

  assert.equal(reason(w.floor.removeReply(aina.id, reply.id)), 'not-yours');
  value(w.floor.removeReply(host.id, reply.id));
  assert.equal(w.feed(aina.id).posts[0]?.replies, 0);
  assert.equal(reason(w.floor.removePost(abu.id, post.id)), 'not-yours');
  value(w.floor.removePost(aina.id, post.id));
  assert.deepEqual(w.titles(aina.id), []);
  assert.equal(w.floor.thread(aina.id, post.id), null);
  assert.deepEqual(w.floor.searchPosts(aina.id, 'dormant'), []);
});

test('a suspended member’s posts and replies leave the Floor', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const host = await w.host;
  const post = value(w.floor.post(aina.id, draft()));
  value(w.floor.post(abu.id, draft({ title: 'A question from Abu' })));
  value(w.floor.reply(abu.id, post.id, { body: 'Yes.', correction: false }, SITE));
  value(w.club.suspendMember(host.id, abu.id, SITE));
  assert.deepEqual(w.titles(aina.id), ['Does a dormant Sdn Bhd still need an audit?']);
  assert.equal(w.feed(aina.id).posts[0]?.replies, 0);
});

test('search finds posts and listed people by the start of a word, five at most', async () => {
  const w = world();
  const aina = await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  const hidden = await w.joined('Ainul Unlisted', 'ainul@firm.my', 'ainul');
  assert.ok(w.profiles.save(hidden.id, null, { headline: '', sector: null, city: '', jurisdictions: [], topics: [], creator: false, listed: false }).ok);
  value(w.floor.post(aina.id, draft({ title: 'MFRS 16 leases for a small firm' })));
  value(w.floor.post(aina.id, draft({ title: 'Release dates for exams', body: '' })));

  assert.deepEqual(w.floor.searchPosts(null, 'lease').map((p) => p.title), ['MFRS 16 leases for a small firm']);
  assert.deepEqual(w.floor.searchPosts(null, 'aded'), [], 'the middle of a word does not match');
  assert.deepEqual(w.floor.searchPosts(null, 'traded').map((p) => p.title), ['MFRS 16 leases for a small firm']);
  assert.deepEqual(w.profiles.search('ain').map((p) => p.handle), ['aina'], 'unlisted profiles stay out');
  assert.deepEqual(w.profiles.search('rahman').map((p) => p.name), ['Aina Rahman']);
  for (let i = 0; i < 6; i++) await w.joined(`Tan ${i}`, `tan${i}@firm.my`, `tan_${i}`);
  assert.equal(w.profiles.search('tan').length, 5);
  assert.equal(w.floor.searchPosts(null, '%').length, 0);
});

test('reports: once each, never about yourself, and the team hides or dismisses them', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const siti = await w.joined('Siti', 'siti@firm.my', 'siti');
  const host = await w.host;
  const post = value(w.floor.post(aina.id, draft()));
  const reply = value(w.floor.reply(abu.id, post.id, { body: 'Ask Tan & Co, they audit ACME Sdn Bhd.', correction: false }, SITE));

  assert.equal(reason(w.floor.report(aina.id, { target: 'post', id: post.id }, 'spam', '')), 'self');
  value(w.floor.report(aina.id, { target: 'reply', id: reply.id }, 'client', 'Names a client.'));
  assert.equal(reason(w.floor.report(aina.id, { target: 'reply', id: reply.id }, 'abuse', '')), 'already');
  value(w.floor.report(siti.id, { target: 'reply', id: reply.id }, 'client', ''));
  value(w.floor.report(siti.id, { target: 'profile', handle: '@Abu' }, 'impersonation', 'Not the real Abu.'));
  assert.equal(reason(w.floor.report(siti.id, { target: 'profile', handle: 'nobody' }, 'spam', '')), 'not-found');
  assert.throws(() => w.floor.report(siti.id, { target: 'post', id: post.id }, 'its-me', ''), TypeError);

  const queue = w.floor.reports();
  assert.deepEqual(queue.map((item) => [item.target, item.reports.length, item.path]), [
    ['reply', 2, `/post/${post.id}#reply-${reply.id}`],
    ['profile', 1, '/@abu'],
  ]);
  assert.equal(queue[0]?.reports[0]?.reason, 'It names a client or shares their details');
  assert.equal(queue[0]?.reports[0]?.reporter, 'aina');

  value(w.floor.decideReports(host.id, 'reply', reply.id, 'hide'));
  assert.equal(reason(w.floor.decideReports(host.id, 'reply', reply.id, 'hide')), 'not-found');
  const thread = w.floor.thread(siti.id, post.id);
  assert.equal(thread?.state === 'open' && thread.replies.length, 0);
  value(w.floor.decideReports(host.id, 'profile', abu.id, 'dismiss'));
  assert.deepEqual(w.floor.reports(), []);
  assert.equal(w.profiles.profile('abu')?.listed, true, 'a dismissed report changes nothing');

  value(w.floor.report(siti.id, { target: 'profile', handle: 'abu' }, 'spam', ''));
  value(w.floor.decideReports(host.id, 'profile', abu.id, 'hide'));
  assert.equal(w.profiles.profile('abu')?.listed, false, 'hiding a profile takes it off The List');
});

test('the SQL seal agrees with the seal the profile shows', async () => {
  const w = world();
  const none = await w.joined('None', 'none@firm.my', 'none');
  const accountOnly = await w.joined('Account', 'account@firm.my', 'acct_only');
  const sealed = await w.joined('Sealed', 'sealed@firm.my', 'sealed');
  const account = value(w.claims.addAccount(accountOnly.id, 'X', 'acct_only'));
  value(w.claims.decideAccount(account.id, (await w.host).id, { verdict: 'approve' }));
  value(w.claims.addClaim(accountOnly.id, { kind: 'experience', text: 'Six years in audit' }));
  await w.seal(sealed.id, 'sealed');
  for (const [member, handle] of [[none, 'none'], [accountOnly, 'acct_only'], [sealed, 'sealed']] as const) {
    const row = w.db.prepare(`SELECT ${sealedSql('m.id')} AS sealed FROM members m WHERE m.id = ?`).get(member.id);
    assert.equal(row?.sealed === 1, w.profiles.profile(handle)?.sealed, handle);
  }
});

test('the members’ room opens to club members, in grace too, and the team; to nobody else, in any read or write', async () => {
  const w = world();
  const mei = await w.joined('Mei', 'mei@practice.my', 'mei');
  const lim = await w.joined('Lim', 'lim@practice.my', 'lim');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const host = await w.host;
  w.pay(mei.id, 'year');
  w.pay(lim.id, 'month');
  await w.licence(priya.id);
  const room = value(w.floor.post(mei.id, draft({ room: 'club', title: 'How do you price a first-year retainer?' })));
  const limsPost = value(w.floor.post(lim.id, draft({ room: 'club', title: 'Quarterly retainers, anyone?' })));
  const shop = value(w.floor.post(priya.id, draft({ room: 'practice', title: 'Fees for a first-year audit client' })));
  value(w.floor.post(priya.id, draft({ title: 'Is a dormant company exempt from audit?' })));
  const limsReply = value(w.floor.reply(lim.id, room.id, { body: 'Monthly, paid ahead.', correction: false }, SITE));
  value(w.floor.reply(mei.id, limsPost.id, { body: 'We do, for small clients.', correction: false }, SITE));

  w.later(31 * DAY);
  for (const [who, id] of [['a club member', mei.id], ['a member in grace', lim.id], ['the team', host.id]] as const) {
    assert.equal(w.feed(id, { room: 'club' }).locked, null, who);
    assert.deepEqual(w.titles(id, { room: 'club' }), ['Quarterly retainers, anyone?', 'How do you price a first-year retainer?'], who);
    assert.equal(w.floor.thread(id, room.id)?.state, 'open', who);
    assert.deepEqual(w.floor.searchPosts(id, 'retainer').map((p) => p.id), [limsPost.id, room.id], who);
    assert.deepEqual(w.floor.recentPosts(id, mei.id).map((p) => p.id), [room.id], who);
  }
  assert.deepEqual(w.titles(mei.id), ['Is a dormant company exempt from audit?', 'Quarterly retainers, anyone?', 'How do you price a first-year retainer?'], 'all rooms: the members’ room in, the practitioners’ room out');
  assert.equal(w.notifications.unread(lim.id), 1, 'in grace, Lim hears about Mei’s reply');

  w.later(9 * DAY);
  for (const [who, id] of [['anyone', null], ['a member past grace', lim.id], ['a licensed member with no club', priya.id]] as const) {
    assert.equal(w.feed(id, { room: 'club' }).locked, 'club', who);
    assert.deepEqual(w.feed(id, { room: 'club' }).posts, [], who);
    assert.deepEqual(w.feed(id).rooms.find((r) => r.id === 'club'), { id: 'club', name: 'Members’ room', locked: 'club', posts: 0 }, `${who}: not even a count`);
    assert.deepEqual(w.feed(id).posts.filter((p) => p.room === 'club'), [], `${who}: nor in all rooms`);
    assert.deepEqual(w.floor.thread(id, room.id), { state: 'locked', viewer: w.floor.viewer(id), room: 'club', locked: 'club' }, who);
    assert.deepEqual(w.floor.searchPosts(id, 'retainer'), [], who);
    assert.deepEqual(w.floor.recentPosts(id, mei.id), [], `${who}: not on Mei’s profile`);
  }
  for (const id of [lim.id, priya.id]) {
    assert.equal(reason(w.floor.reply(id, room.id, { body: 'Hourly.', correction: false }, SITE)), 'not-found');
    assert.equal(reason(w.floor.markUseful(id, 'post', room.id)), 'not-found');
    assert.equal(reason(w.floor.unmarkUseful(id, 'post', room.id)), 'not-found');
    assert.equal(reason(w.floor.report(id, { target: 'post', id: room.id }, 'spam', '')), 'not-found');
    assert.equal(reason(w.floor.post(id, draft({ room: 'club' }))), 'needs-club');
  }
  assert.equal(reason(w.floor.removeReply(lim.id, limsReply.id)), 'not-found', 'past grace, Lim cannot reach his own words there');
  assert.equal(w.notifications.unread(lim.id), 0, 'and his notification about the room is gone');
  assert.deepEqual(w.notifications.list(lim.id), []);
  assert.equal(w.floor.thread(mei.id, shop.id)?.state, 'locked', 'the club does not open the practitioners’ room');
});

test('a post moves only between rooms open to the same people, so replies never reach readers they were not written for', async () => {
  const w = world();
  const mei = await w.joined('Mei', 'mei@practice.my', 'mei');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  w.pay(mei.id, 'year');
  w.pay(priya.id, 'year');
  await w.licence(priya.id);
  const room = value(w.floor.post(mei.id, draft({ room: 'club', title: 'How do you price a first-year retainer?' })));
  const open = value(w.floor.post(mei.id, draft()));
  const shop = value(w.floor.post(priya.id, draft({ room: 'practice', title: 'Fees for a first-year audit client' })));

  assert.equal(reason(w.floor.editPost(mei.id, room.id, draft({ room: 'open' }))), 'room-access', 'out of the members’ room');
  assert.equal(reason(w.floor.editPost(mei.id, open.id, draft({ room: 'club' }))), 'room-access', 'into it');
  assert.equal(reason(w.floor.editPost(priya.id, shop.id, draft({ room: 'club' }))), 'room-access', 'between two closed rooms');
  assert.equal(reason(w.floor.editPost(mei.id, open.id, draft({ room: 'audit' }))), null, 'between open rooms, as before');
  assert.equal(reason(w.floor.editPost(mei.id, room.id, draft({ room: 'club', title: 'How do you price a retainer?' }))), null, 'and within the room');
  assert.deepEqual(w.titles(null), ['Does a dormant Sdn Bhd still need an audit?']);
});

test('nobody outside the club moves a post into the members’ room: not a licensed member, not a lapsed one', async () => {
  const w = world();
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const lim = await w.joined('Lim', 'lim@practice.my', 'lim');
  await w.licence(priya.id);
  w.pay(lim.id, 'month');
  w.later(40 * DAY);
  for (const [who, id] of [['a licensed member with no club', priya.id], ['a member past grace', lim.id]] as const) {
    const own = value(w.floor.post(id, draft({ title: `A question from ${who}` })));
    assert.equal(reason(w.floor.editPost(id, own.id, draft({ room: 'club' }))), 'room-access', who);
  }
  assert.deepEqual(w.titles(null, { room: 'club' }), []);
});

test('a paying member with no handle reads the members’ room, and claims a handle to post with no invite', async () => {
  const w = world();
  const mei = await w.joined('Mei', 'mei@practice.my', 'mei');
  const tan = await w.clubJoined('Tan', 'tan@practice.my');
  w.pay(mei.id, 'year');
  w.pay(tan.id, 'month');
  value(w.floor.post(mei.id, draft({ room: 'club', title: 'How do you price a first-year retainer?' })));

  assert.equal(w.profiles.entry(tan.id), null, 'nothing let Tan into Social');
  assert.deepEqual(w.titles(tan.id, { room: 'club' }), ['How do you price a first-year retainer?'], 'reading needs no handle');
  assert.equal(reason(w.floor.post(tan.id, draft({ room: 'club' }))), 'no-handle');
  assert.equal(w.profiles.mayClaim(tan.id), true, 'the club let him in');
  const profile = value(w.profiles.claimHandle(tan.id, 'tan'));
  assert.equal(profile.listed, true, 'a new handle is on The List until he says otherwise');
  assert.deepEqual(w.profiles.entry(tan.id), { via: 'club', inviterId: null });
  assert.equal(reason(w.floor.post(tan.id, draft({ room: 'club', title: 'Retainers: monthly or quarterly?' }))), null);
});

test('the club’s board moves into the members’ room; posts by removed members and deleted ones stay behind', async () => {
  const w = world(SCHEMA_VERSION - 1);
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const tan = await w.clubJoined('Tan', 'tan@practice.my');
  w.pay(aina.id, 'year');
  const sql = (statement: string, ...params: (string | number | null)[]) => w.db.prepare(statement).run(...params).lastInsertRowid;
  const thread = (author: number | null, title: string, removed: string | null = null) =>
    sql(`INSERT INTO threads (channel, title, author_id, created_at, last_post_at, removed_at) VALUES ('pricing', ?, ?, '2026-10-01T03:00:00Z', '2026-10-02T03:00:00Z', ?)`, title, author, removed);
  const post = (threadId: number, author: number | null, body: string, at: string, deleted: string | null = null, edited: string | null = null) =>
    sql('INSERT INTO posts (thread_id, author_id, body, created_at, edited_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)', threadId, author, body, at, edited, deleted);

  const kept = thread(aina.id, 'Monthly or annual billing?');
  post(kept, aina.id, 'How do you bill?', '2026-10-01T03:00:00Z', null, '2026-10-01T03:05:00Z');
  post(kept, abu.id, 'Annual, with a discount.', '2026-10-01T04:00:00Z');
  post(kept, abu.id, '', '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z');
  post(kept, null, 'From someone since removed.', '2026-10-01T07:00:00Z');
  post(kept, tan.id, 'Monthly, by card.', '2026-10-02T03:00:00Z');
  const orphan = thread(null, 'Started by someone since removed');
  post(orphan, null, 'Gone.', '2026-10-01T03:00:00Z');
  post(orphan, abu.id, 'A reply under it.', '2026-10-01T04:00:00Z');
  const emptied = thread(aina.id, 'Opening post deleted');
  post(emptied, aina.id, '', '2026-10-01T03:00:00Z', '2026-10-01T03:30:00Z');
  post(emptied, abu.id, 'A reply under it.', '2026-10-01T04:00:00Z');
  const taken = thread(aina.id, 'Taken down', '2026-10-03T00:00:00Z');
  post(taken, aina.id, 'Spam.', '2026-10-01T03:00:00Z');
  sql(`INSERT INTO reply_notices (member_id, thread_id, sent_at) VALUES (?, ?, '2026-10-01T04:00:00Z')`, aina.id, kept);

  migrate(w.db);

  const tables = w.db.prepare(`SELECT name FROM sqlite_master WHERE name IN ('threads', 'posts', 'reply_notices', 'floor_reply_notices')`).all().map((row) => row['name']);
  assert.deepEqual(tables, ['floor_reply_notices']);
  assert.equal(w.db.prepare('SELECT count(*) AS n FROM floor_posts').get()?.['n'], 1, 'one thread had a live opening post by a member still here');
  const view = w.floor.thread(aina.id, w.feed(aina.id, { room: 'club' }).posts[0]?.id ?? 0);
  assert.ok(view?.state === 'open');
  assert.deepEqual(
    { room: view.post.room, jurisdiction: view.post.jurisdiction, title: view.post.title, body: view.post.body, createdAt: view.post.createdAt, editedAt: view.post.editedAt, author: view.post.author.handle },
    { room: 'club', jurisdiction: 'Any', title: 'Monthly or annual billing?', body: 'How do you bill?', createdAt: '2026-10-01T03:00:00Z', editedAt: '2026-10-01T03:05:00Z', author: 'aina' },
  );
  assert.deepEqual(view.replies.map((r) => [r.body, r.createdAt]), [['Annual, with a discount.', '2026-10-01T04:00:00Z']], 'Tan’s reply waits for his handle');
  assert.equal(w.db.prepare('SELECT count(*) AS n FROM floor_replies').get()?.['n'], 2);

  value(w.profiles.claimHandle(tan.id, 'tan'));
  const after = w.floor.thread(aina.id, view.post.id);
  assert.deepEqual(after?.state === 'open' && after.replies.map((r) => r.author.handle), ['abu', 'tan']);
  assert.equal(w.feed(null, { room: 'club' }).locked, 'club', 'and only the club reads it');
});

test('a reply emails the post’s author and earlier repliers who can still open the room, each at most once every six hours', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const siti = await w.joined('Siti', 'siti@firm.my', 'siti');
  const quiet = await w.joined('Quiet', 'quiet@firm.my', 'quiet');
  w.pay(aina.id, 'year');
  w.pay(abu.id, 'year');
  w.pay(siti.id, 'month');
  w.pay(quiet.id, 'year');
  w.mailings.setPrefs(quiet.id, { replies: false, digest: false });
  const post = value(w.floor.post(aina.id, draft({ room: 'club', title: 'Fixed fees for audits' })));
  const reply = (memberId: number, body: string) => value(w.floor.reply(memberId, post.id, { body, correction: false }, SITE));

  const first = reply(abu.id, 'Per entity.');
  assert.deepEqual(to(first.letters), ['aina@firm.my'], 'the replier is not told');
  assert.equal(first.letters[0]?.subject, 'Abu replied to “Fixed fees for audits”');
  assert.ok(first.letters[0]?.lines.some((line) => typeof line === 'object' && 'href' in line && line.href === `https://social.therestisaccountancy.com/post/${post.id}#reply-${first.id}`), 'the link opens the reply on the social host');
  assert.deepEqual(to(reply(quiet.id, 'Per hour.').letters), ['abu@firm.my'], 'Aina, told minutes ago, waits');
  assert.deepEqual(to(reply(siti.id, 'Per hour, sadly.').letters), [], 'Abu too; Quiet turned these off');
  assert.deepEqual(to(reply(abu.id, 'Try fixed.').letters), ['siti@firm.my']);

  w.later(REPLY_NOTICE_GAP_MS + 1);
  assert.deepEqual(to(reply(abu.id, 'Still fixed.').letters), ['aina@firm.my', 'siti@firm.my'], 'six hours on, everyone who wants them hears again');
  w.later(40 * DAY);
  assert.deepEqual(to(reply(aina.id, 'Thanks, all.').letters), ['abu@firm.my'], 'Siti, past grace, can no longer open the room');
  assert.equal(w.db.prepare('SELECT count(*) AS n FROM floor_reply_notices').get()?.['n'], 3, 'one record per member and post');

  const open = value(w.floor.post(siti.id, draft({ title: 'Audit exemption thresholds' })));
  assert.deepEqual(to(value(w.floor.reply(abu.id, open.id, { body: 'RM100k revenue.', correction: false }, SITE)).letters), ['siti@firm.my'], 'in an open room anyone with a handle hears');
});

test('the Monday digest lists the week in rooms every club member opens, and goes only to opted-in members with the club', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const social = await w.joined('Sam', 'sam@firm.my', 'sam');
  const lapsing = await w.joined('Lim', 'lim@firm.my', 'lim');
  w.pay(aina.id, 'year');
  w.pay(abu.id, 'year');
  w.pay(lapsing.id, 'month');
  await w.licence(abu.id);
  await w.licence(aina.id);
  value(w.floor.post(aina.id, draft({ title: 'Last month’s question' })));
  w.later(30 * DAY);
  const room = value(w.floor.post(aina.id, draft({ room: 'club', title: 'How do you price a first-year retainer?' })));
  const open = value(w.floor.post(social.id, draft({ title: 'Is a dormant company exempt?' })));
  const shop = value(w.floor.post(abu.id, draft({ room: 'practice', title: 'Fees for a first-year audit client' })));
  const gone = value(w.floor.post(social.id, draft({ title: 'Deleted by its author' })));
  value(w.floor.removePost(social.id, gone.id));
  for (const body of ['Monthly.', 'Quarterly.']) value(w.floor.reply(abu.id, open.id, { body, correction: false }, SITE));
  value(w.floor.reply(abu.id, room.id, { body: 'Monthly, ahead.', correction: false }, SITE));
  value(w.floor.reply(aina.id, shop.id, { body: 'Ask the MIA.', correction: false }, SITE));

  const week = w.floor.digest(new Date(Date.parse('2026-12-26T02:00:00Z') - 7 * DAY));
  assert.deepEqual(
    week.posts.map((p) => [p.title, p.room, p.replies]),
    [
      ['Is a dormant company exempt?', 'tax-my', 2],
      ['How do you price a first-year retainer?', 'club', 1],
    ],
    'most replied first; never the practitioners’ room, a removed post or last month',
  );
  assert.equal(week.replies, 3, 'replies in the practitioners’ room are not counted');

  for (const member of [aina, abu, social, lapsing]) w.mailings.setPrefs(member.id, { replies: true, digest: true });
  w.later(4 * DAY);
  assert.deepEqual(w.mailings.digestRecipients().map((r) => r.email), ['aina@firm.my', 'abu@firm.my'], 'not Sam, who never joined the club, nor Lim, past grace');
});

test('reports waiting count one per reported thing, since its oldest open report', async () => {
  const w = socialWorld();
  const reviewer = (await w.host).id;
  const aina = await w.joined('Aina Rahman', 'aina@firm.com.my', 'ainarahman');
  const abu = await w.joined('Abu Musa', 'abu@firm.com.my', 'abumusa');
  const siti = await w.joined('Siti Aminah', 'siti@firm.com.my', 'sitiaminah');
  await w.seal(aina.id, 'aina-rahman');
  const post = value(w.floor.post(aina.id, { room: 'open', jurisdiction: 'MY', title: 'A client called', body: 'It names Client Sdn Bhd.' }));
  assert.deepEqual(w.floor.waiting(), { count: 0, since: null });

  value(w.floor.report(abu.id, { target: 'post', id: post.id }, 'client', 'Names the client.'));
  w.later(3_600_000);
  value(w.floor.report(siti.id, { target: 'post', id: post.id }, 'client', ''));
  value(w.floor.report(abu.id, { target: 'profile', handle: 'sitiaminah' }, 'impersonation', ''));
  assert.deepEqual(w.floor.waiting(), { count: 2, since: '2026-11-26T02:00:00Z' }, 'two reports on one post are one thing to decide');
  assert.equal(w.floor.waiting().count, w.floor.reports().length);

  value(w.floor.decideReports(reviewer, 'post', post.id, 'dismiss'));
  assert.deepEqual(w.floor.waiting(), { count: 1, since: '2026-11-26T03:00:00Z' }, 'a decided thing leaves the count');
});
