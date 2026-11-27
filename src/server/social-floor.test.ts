import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import type { PostDraft } from './social-floor.ts';
import { sealedSql } from './social-profiles.ts';
import { createStore } from './store.ts';

const SITE = 'https://therestisaccountancy.com/';

const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;

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

const world = () => {
  let clock = new Date('2026-11-26T02:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  const { club, socialProfiles: profiles, socialClaims: claims, socialFloor: floor } = createStore(db, now);
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
  const feed = (viewerId: number | null, changes: Partial<Parameters<typeof floor.feed>[1]> = {}) => floor.feed(viewerId, { room: null, filter: 'all', offset: 0, ...changes });
  const titles = (viewerId: number | null, changes: Partial<Parameters<typeof floor.feed>[1]> = {}) => feed(viewerId, changes).posts.map((p) => p.title);
  return { db, club, profiles, claims, floor, host, joined, seal, licence, feed, titles, later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

test('posting needs a handle, and the practitioners’ room is only for ticked licences', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const clubOnly = await w.host;

  assert.equal(reason(w.floor.post(clubOnly.id, draft())), 'no-handle');
  assert.equal(reason(w.floor.post(aina.id, draft({ room: 'practice' }))), 'room-locked');
  await w.licence(priya.id);
  const shop = value(w.floor.post(priya.id, draft({ room: 'practice', title: 'Fees for a first-year audit client' })));
  value(w.floor.post(aina.id, draft()));

  assert.deepEqual(w.titles(aina.id), ['Does a dormant Sdn Bhd still need an audit?'], 'the open feed leaves the room out');
  assert.deepEqual(w.titles(null), ['Does a dormant Sdn Bhd still need an audit?']);
  assert.equal(w.feed(aina.id, { room: 'practice' }).locked, true);
  assert.deepEqual(w.feed(aina.id, { room: 'practice' }).posts, []);
  assert.equal(w.feed(aina.id).rooms.find((r) => r.id === 'practice')?.locked, true);
  assert.equal(w.floor.thread(aina.id, shop.id)?.state, 'locked');
  assert.deepEqual(w.floor.searchPosts(aina.id, 'fees'), []);
  assert.deepEqual(w.floor.recentPosts(aina.id, priya.id), [], 'nor does her profile');
  assert.equal(reason(w.floor.reply(aina.id, shop.id, { body: 'Charge more.', correction: false })), 'not-found');

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

  const fromAbu = value(w.floor.reply(abu.id, mine.id, { body: 'Service tax applies.', correction: false }));
  value(w.floor.accept(aina.id, fromAbu.id));
  assert.deepEqual(w.titles(aina.id, { filter: 'ticked' }), [], 'an answer from someone without the seal is not a ticked answer');
  const fromSiti = value(w.floor.reply(siti.id, mine.id, { body: 'Service tax at 8%, from March 2024.', correction: false }));
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
  const reply = value(w.floor.reply(siti.id, post.id, { body: 'Yes, unless it qualifies for the exemption.', correction: false }));

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
  const reply = value(w.floor.reply(dan.id, post.id, { body: 'Yes.', correction: false }));
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

  assert.equal(reason(w.floor.reply(abu.id, post.id, { body: 'That figure is wrong.', correction: true })), 'no-seal');
  const fix = value(w.floor.reply(siti.id, post.id, { body: 'The threshold is RM500,000, not RM50,000.', correction: true }));
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
  const reply = value(w.floor.reply(abu.id, post.id, { body: 'It does.', correction: false }));

  assert.equal(reason(w.floor.markUseful(aina.id, 'post', post.id)), 'self');
  assert.deepEqual(value(w.floor.markUseful(abu.id, 'post', post.id)), { useful: 1 });
  assert.deepEqual(value(w.floor.markUseful(abu.id, 'post', post.id)), { useful: 1 }, 'marking again changes nothing');
  assert.deepEqual(value(w.floor.markUseful(aina.id, 'reply', reply.id)), { useful: 1 });
  assert.equal(w.feed(abu.id).posts[0]?.usefulByViewer, true);
  assert.equal(w.feed(aina.id).posts[0]?.usefulByViewer, false);
  assert.deepEqual(w.floor.unmarkUseful(abu.id, 'post', post.id), { useful: 0 });
  assert.equal(reason(w.floor.markUseful(abu.id, 'post', 999)), 'not-found');
});

test('replies sort by useful marks or newest, with the accepted one first', async () => {
  const w = world();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const siti = await w.joined('Siti', 'siti@firm.my', 'siti');
  const post = value(w.floor.post(aina.id, draft()));
  const first = value(w.floor.reply(abu.id, post.id, { body: 'First.', correction: false }));
  w.later(MINUTE);
  const second = value(w.floor.reply(siti.id, post.id, { body: 'Second.', correction: false }));
  w.later(MINUTE);
  const third = value(w.floor.reply(abu.id, post.id, { body: 'Third.', correction: false }));
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
  const reply = value(w.floor.reply(abu.id, post.id, { body: 'Yes.', correction: false }));

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
  value(w.floor.reply(abu.id, post.id, { body: 'Yes.', correction: false }));
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
  const reply = value(w.floor.reply(abu.id, post.id, { body: 'Ask Tan & Co, they audit ACME Sdn Bhd.', correction: false }));

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
