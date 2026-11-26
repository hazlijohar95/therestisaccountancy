import assert from 'node:assert/strict';
import { test } from 'node:test';
import { at, DAY, socialWorld, value } from './social-fixtures.ts';
import type { PostDraft } from './social-floor.ts';

const post: PostDraft = { room: 'tax-my', jurisdiction: 'MY', title: 'Does a dormant Sdn Bhd still need an audit?', body: '' };
const kinds = (w: ReturnType<typeof socialWorld>, memberId: number) => w.notifications.list(memberId).map((n) => n.kind);

test('replies, accepted answers, useful marks and follows notify the person they are about, once, never the actor', async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const { id: postId } = value(w.floor.post(aina.id, post));
  const { id: replyId } = value(w.floor.reply(priya.id, postId, { body: 'Section 267A.', correction: false }));
  value(w.floor.reply(aina.id, postId, { body: 'Thanks.', correction: false }));
  value(w.floor.accept(aina.id, replyId));
  value(w.floor.unaccept(aina.id, replyId));
  value(w.floor.accept(aina.id, replyId));
  value(w.floor.markUseful(priya.id, 'post', postId));
  w.floor.unmarkUseful(priya.id, 'post', postId);
  value(w.floor.markUseful(priya.id, 'post', postId));
  value(w.profiles.follow(priya.id, 'aina'));
  w.profiles.unfollow(priya.id, 'aina');
  value(w.profiles.follow(priya.id, 'aina'));

  assert.deepEqual(kinds(w, aina.id).sort(), ['follow', 'reply', 'useful'], 'her own reply notifies nobody');
  assert.deepEqual(kinds(w, priya.id), ['accepted']);
  const [reply] = w.notifications.list(aina.id).filter((n) => n.kind === 'reply');
  assert.ok(reply?.kind === 'reply');
  assert.equal(reply.actor.handle, 'priya');
  assert.equal(reply.title, post.title);
  assert.equal(reply.postId, postId);
});

test('the bell counts what is unread and still there; viewing marks everything read', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  const { id: postId } = value(w.floor.post(aina.id, post));
  value(w.floor.reply(priya.id, postId, { body: 'One.', correction: false }));
  value(w.profiles.follow(abu.id, 'aina'));
  assert.equal(w.notifications.unread(aina.id), 2);

  w.notifications.markRead(aina.id);
  assert.equal(w.notifications.unread(aina.id), 0);
  assert.equal(w.notifications.list(aina.id).length, 2, 'read ones stay in the list');

  w.later(60_000);
  value(w.floor.reply(abu.id, postId, { body: 'Two.', correction: false }));
  assert.equal(w.notifications.unread(aina.id), 1);
  assert.equal(w.notifications.list(aina.id)[0]?.unread, true, 'newest first');

  value(w.club.suspendMember(host.id, abu.id));
  assert.equal(w.notifications.unread(aina.id), 0, 'a suspended actor drops out');
  value(w.floor.removePost(aina.id, postId));
  assert.deepEqual(kinds(w, aina.id), [], 'a removed post takes its replies’ notifications with it');
});

test('a rating notifies the answer’s author once; a changed rating updates it, a withdrawn one removes it', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  await w.seal(priya.id, 'priya-nair');
  value(
    w.problems.create(host.id, {
      number: 7,
      tag: 'Tax',
      jurisdiction: 'MY',
      title: 'Dormant',
      scenario: ['One.', 'Two.'],
      ask: 'Why?',
      options: ['Yes', 'No'],
      opensAt: at(w.now()),
      closesAt: at(new Date(w.now().getTime() + 7 * DAY)),
    }),
  );
  value(w.problems.answer(aina.id, 7, { pick: 'A', reasoning: '' }));
  value(w.problems.answer(priya.id, 7, { pick: 'B', reasoning: '' }));
  const answerId = w.problems.view(priya.id, 7)?.answers.find((a) => !a.mine)?.id ?? 0;
  value(w.problems.rate(priya.id, answerId, 'partly'));
  w.notifications.markRead(aina.id);
  value(w.problems.rate(priya.id, answerId, 'sound'));

  const notices = w.notifications.list(aina.id);
  assert.equal(notices.length, 1);
  const [rating] = notices;
  assert.ok(rating?.kind === 'rating');
  assert.equal(rating.rating, 'sound');
  assert.equal(rating.number, 7);
  assert.equal(rating.unread, false, 'changing a rating does not ring the bell again');
  value(w.problems.rate(priya.id, answerId, null));
  assert.deepEqual(w.notifications.list(aina.id), [], 'a rating taken back takes its notification with it');
});

test('the team’s decisions, renewals and a claimed nomination notify without an actor', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  await w.seal(aina.id, 'aina-rahman');
  assert.deepEqual(
    w.notifications.list(aina.id).map((n) => (n.kind === 'ticked' ? n.label : n.kind)),
    ['ACCA · Member', 'LinkedIn · @aina-rahman'],
  );

  const licence = value(w.claims.addClaim(aina.id, { kind: 'licence', licence: 'Licensed tax agent', reference: 'TA1', until: '2027-01', evidenceKey: 'k' }));
  value(w.claims.decideClaim(licence.id, host.id, { verdict: 'approve' }));
  w.later(10 * DAY);
  assert.equal(w.claims.dueRenewals().length, 1);
  assert.equal(w.claims.dueRenewals().length, 0, 'each reminder once');
  const renewal = w.notifications.list(aina.id).find((n) => n.kind === 'renewal');
  assert.ok(renewal?.kind === 'renewal');
  assert.deepEqual([renewal.label, renewal.until, renewal.live], ['Licensed tax agent', '2027-01', true]);
  assert.ok(w.claims.removeClaim(aina.id, licence.id).removed);
  assert.equal(
    w.notifications.list(aina.id).some((n) => n.kind === 'renewal'),
    false,
    'a removed claim takes its reminder with it',
  );

  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  value(w.nominations.nominate(priya.id, { platform: 'YouTube', handle: 'taxwithtan', topics: ['Tax'], whyUrl: null }));
  const nomination = w.nominations.queue().pending[0]?.id ?? 0;
  const { token } = value(w.nominations.invite(nomination, host.id));
  value(w.nominations.join(token, { name: 'Tan', email: 'tan@tax.my', handle: 'taxwithtan' }));
  const joined = w.notifications.list(priya.id)[0];
  assert.ok(joined?.kind === 'nominee-joined');
  assert.equal(joined.account, 'YouTube · @taxwithtan');
});
