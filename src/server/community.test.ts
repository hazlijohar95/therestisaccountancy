import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { createCommunity, tidy } from './community.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';

const PASSWORD = 'correct horse battery';

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

/** A board with an admin and two members, and a clock the test can move. */
const setup = async () => {
  const clock = { now: new Date('2026-11-25T09:00:00Z') };
  const db = openDatabase(':memory:');
  const club = createClub(db, () => clock.now);
  const board = createCommunity(db, () => clock.now);
  const admin = await club.ensureAdmin({ email: 'admin@club.test', name: 'Admin', password: PASSWORD });
  const aina = await club.ensureAdmin({ email: 'aina@firm.com.my', name: 'Aina', password: PASSWORD });
  const abu = await club.ensureAdmin({ email: 'abu@firm.com.my', name: 'Abu', password: PASSWORD });
  value(club.updateMember(admin.id, aina.id, { name: 'Aina', email: aina.email, role: 'member' }));
  value(club.updateMember(admin.id, abu.id, { name: 'Abu', email: abu.email, role: 'member' }));
  const later = (seconds: number) => {
    clock.now = new Date(clock.now.getTime() + seconds * 1000);
  };
  return {
    club,
    board,
    later,
    admin: { id: admin.id, role: 'admin' as const },
    aina: { id: aina.id, role: 'member' as const },
    abu: { id: abu.id, role: 'member' as const },
  };
};

test('posts are tidied: plain line endings, trimmed, one blank line at most', () => {
  assert.equal(tidy('  first\r\n\r\n\r\n\r\nsecond\rthird  '), 'first\n\nsecond\nthird');
});

test('a thread opens with its first post, and replies move it to the top of its channel', async () => {
  const { board, later, aina, abu } = await setup();
  const first = board.startThread(aina, { channel: 'pricing', title: 'Monthly or annual?', body: 'How do you bill?' });
  later(120);
  const second = board.startThread(abu, { channel: 'pricing', title: 'Raising rates in January', body: 'Notice period?' });
  assert.equal(first.position, 1);
  assert.deepEqual(board.threads('pricing', { limit: 10, offset: 0 }).items.map((t) => t.id), [second.threadId, first.threadId]);

  later(120);
  const reply = value(board.reply(abu, first.threadId, { body: 'Monthly, by direct debit.' }));
  assert.equal(reply.position, 2);
  const [top] = board.threads('pricing', { limit: 10, offset: 0 }).items;
  assert.equal(top?.id, first.threadId, 'the newest activity rises');
  assert.equal(top?.replies, 1);
  const summary = board.channels().find((c) => c.slug === 'pricing');
  assert.equal(summary?.threads, 2);
  assert.equal(summary?.latest?.id, first.threadId);
  assert.equal(board.channels().find((c) => c.slug === 'wins')?.latest, null);
});

test('the same submission twice within a minute posts once; after a minute it posts again', async () => {
  const { board, later, aina } = await setup();
  const thread = board.startThread(aina, { channel: 'wins', title: 'Closed November on time', body: 'First time this year.' });
  assert.equal(board.startThread(aina, { channel: 'wins', title: 'Closed November on time', body: 'First time this year.' }).threadId, thread.threadId);
  const once = value(board.reply(aina, thread.threadId, { body: 'And December is booked.' }));
  assert.equal(value(board.reply(aina, thread.threadId, { body: 'And December is booked.' })).postId, once.postId);
  later(61);
  assert.notEqual(value(board.reply(aina, thread.threadId, { body: 'And December is booked.' })).postId, once.postId);
  assert.equal(board.posts(thread.threadId, { limit: 10, offset: 0 }).total, 3);
});

test('a locked thread takes replies and edits only from admins', async () => {
  const { board, aina, abu, admin } = await setup();
  const thread = board.startThread(aina, { channel: 'questions', title: 'SST on retainers', body: 'Anyone charging it?' });
  value(board.moderate(admin, thread.threadId, 'lock'));
  assert.equal(reason(board.reply(abu, thread.threadId, { body: 'Late reply' })), 'locked');
  assert.equal(reason(board.editPost(aina, thread.postId, { body: 'Changed' })), 'locked');
  value(board.reply(admin, thread.threadId, { body: 'Locked: answered in the clinic.' }));
  value(board.moderate(admin, thread.threadId, 'unlock'));
  value(board.reply(abu, thread.threadId, { body: 'Thanks.' }));
});

test('only the author edits a post, and an edit is marked', async () => {
  const { board, aina, abu, admin, later } = await setup();
  const thread = board.startThread(aina, { channel: 'tools', title: 'Bank feeds', body: 'Which one?' });
  assert.equal(reason(board.editPost(abu, thread.postId, { body: 'Hijacked' })), 'forbidden');
  assert.equal(reason(board.editPost(admin, thread.postId, { body: 'Moderated' })), 'forbidden', 'admins delete, they do not rewrite');
  later(30);
  value(board.editPost(aina, thread.postId, { body: 'Which bank feed works with Maybank?' }));
  const [post] = board.posts(thread.threadId, { limit: 10, offset: 0 }).items;
  assert.equal(post?.body, 'Which bank feed works with Maybank?');
  assert.equal(post?.editedAt, '2026-11-25T09:00:30Z');
  assert.equal(reason(board.editPost(aina, 999, { body: 'x' })), 'not-found');
});

test('a deleted post is wiped and kept as a placeholder; the last live post going takes the thread with it', async () => {
  const { board, aina, abu, admin } = await setup();
  const thread = board.startThread(aina, { channel: 'clients', title: 'Firing a client', body: 'How do you say it?' });
  const reply = value(board.reply(abu, thread.threadId, { body: 'In writing, with a date.' }));

  assert.equal(reason(board.deletePost(abu, thread.postId)), 'forbidden', 'a member cannot delete another member’s post');
  const opener = value(board.deletePost(aina, thread.postId));
  assert.equal(opener.threadRemoved, false, 'a reply is still live, so the thread stays');
  const [wiped] = board.posts(thread.threadId, { limit: 10, offset: 0 }).items;
  assert.deepEqual([wiped?.deleted, wiped?.body], [true, '']);
  assert.equal(reason(board.editPost(aina, thread.postId, { body: 'Back again' })), 'not-found', 'a deleted post cannot be edited back');
  assert.equal(board.thread(thread.threadId)?.replies, 1, 'the reply still counts after the opener goes');

  const last = value(board.deletePost(admin, reply.postId));
  assert.equal(last.threadRemoved, true, 'no live post left: the thread is gone');
  assert.equal(board.thread(thread.threadId), null);
  assert.equal(board.threads('clients', { limit: 10, offset: 0 }).total, 0);
  assert.equal(reason(board.reply(abu, thread.threadId, { body: 'Hello?' })), 'not-found');
  assert.equal(reason(board.deletePost(admin, reply.postId)), 'not-found');
});

test('a thread whose only post is deleted disappears at once', async () => {
  const { board, aina } = await setup();
  const thread = board.startThread(aina, { channel: 'wins', title: 'Posted too soon', body: 'Oops' });
  assert.equal(value(board.deletePost(aina, thread.postId)).threadRemoved, true);
  assert.equal(board.recent(10).length, 0);
});

test('moderation is for admins, repeats harmlessly, and pinned threads lead their channel', async () => {
  const { board, aina, admin, later } = await setup();
  const rules = board.startThread(admin, { channel: 'introductions', title: 'Start here', body: 'Say who you are.' });
  later(120);
  const hello = board.startThread(aina, { channel: 'introductions', title: 'Aina from Shah Alam', body: 'Hello.' });
  assert.equal(reason(board.moderate(aina, rules.threadId, 'pin')), 'forbidden');
  value(board.moderate(admin, rules.threadId, 'pin'));
  value(board.moderate(admin, rules.threadId, 'pin'));
  assert.deepEqual(board.threads('introductions', { limit: 10, offset: 0 }).items.map((t) => [t.id, t.pinned]), [
    [rules.threadId, true],
    [hello.threadId, false],
  ]);
  assert.equal(board.postCount(aina.id), 1);
  value(board.moderate(admin, hello.threadId, 'remove'));
  assert.equal(board.postCount(aina.id), 0, 'posts in a removed thread no longer count');
  assert.equal(reason(board.moderate(admin, hello.threadId, 'remove')), 'not-found', 'a removed thread is gone for everyone');
  assert.equal(board.threads('introductions', { limit: 10, offset: 0 }).total, 1);
});

test('a removed member’s posts stay, without a name', async () => {
  const { club, board, aina, admin } = await setup();
  const thread = board.startThread(aina, { channel: 'tools', title: 'My template', body: 'Sharing my engagement letter.' });
  value(club.removeMember(admin.id, aina.id));
  const kept = board.thread(thread.threadId);
  assert.equal(kept?.author, null);
  assert.equal(board.posts(thread.threadId, { limit: 10, offset: 0 }).items[0]?.body, 'Sharing my engagement letter.');
  assert.equal(board.postCount(aina.id), 0);
});

test('posts page in order, and a post knows its place', async () => {
  const { board, aina, abu, later } = await setup();
  const thread = board.startThread(aina, { channel: 'questions', title: 'Long thread', body: 'Post 1' });
  let last = thread;
  for (let n = 2; n <= 7; n++) {
    later(1);
    last = value(board.reply(n % 2 ? aina : abu, thread.threadId, { body: `Post ${n}` }));
  }
  assert.equal(last.position, 7);
  const second = board.posts(thread.threadId, { limit: 3, offset: 3 });
  assert.equal(second.total, 7);
  assert.deepEqual(second.items.map((p) => p.body), ['Post 4', 'Post 5', 'Post 6']);
});
