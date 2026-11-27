import { channelSlugs, channels, type ChannelSlug } from '../data/community.ts';
import { ROLES, type Member, type Role } from './club.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import { noticeReply, type ReplyNotices } from './mailings.ts';
import type { Result } from './result.ts';

/** Who wrote something. Null once the member has been removed: their words stay, their name goes. */
export interface Author {
  readonly id: number;
  readonly name: string;
  readonly role: Role;
}

export interface Thread {
  readonly id: number;
  readonly channel: ChannelSlug;
  readonly title: string;
  readonly author: Author | null;
  readonly createdAt: string;
  readonly lastPostAt: string;
  readonly replies: number;
  readonly pinned: boolean;
  readonly locked: boolean;
}

export interface Post {
  readonly id: number;
  readonly threadId: number;
  readonly author: Author | null;
  /** Empty once deleted. */
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deleted: boolean;
}

export interface ChannelSummary {
  readonly slug: ChannelSlug;
  readonly threads: number;
  readonly latest: Thread | null;
}

/** Where a post sits in its thread, counted from 1, so a page can be worked out from it. */
export interface PostPlace {
  readonly threadId: number;
  readonly channel: ChannelSlug;
  readonly postId: number;
  readonly position: number;
}

export type Actor = Pick<Member, 'id' | 'role'>;
export type PostRefusal = 'not-found' | 'locked' | 'forbidden';
export const MODERATIONS = ['pin', 'unpin', 'lock', 'unlock', 'remove'] as const;
export type Moderation = (typeof MODERATIONS)[number];

/** A second identical submission inside this window returns the first instead of posting twice. */
const DUPLICATE_WINDOW_MS = 60_000;

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const authorOf = (row: Row): Author | null => {
  const name = optionalText(row, 'author_name');
  return name === null ? null : { id: integer(row, 'author_id'), name, role: oneOf(row, 'author_role', ROLES) };
};

const toThread = (row: Row): Thread => ({
  id: integer(row, 'id'),
  channel: oneOf(row, 'channel', channelSlugs),
  title: text(row, 'title'),
  author: authorOf(row),
  createdAt: text(row, 'created_at'),
  lastPostAt: text(row, 'last_post_at'),
  replies: integer(row, 'replies'),
  pinned: integer(row, 'pinned') === 1,
  locked: integer(row, 'locked') === 1,
});

const toPost = (row: Row): Post => ({
  id: integer(row, 'id'),
  threadId: integer(row, 'thread_id'),
  author: authorOf(row),
  body: text(row, 'body'),
  createdAt: text(row, 'created_at'),
  editedAt: optionalText(row, 'edited_at'),
  deleted: optionalText(row, 'deleted_at') !== null,
});

const THREAD_COLUMNS = `
  t.*, m.name AS author_name, m.role AS author_role,
  (SELECT count(*) FROM posts p WHERE p.thread_id = t.id AND p.deleted_at IS NULL
     AND p.id > (SELECT min(id) FROM posts WHERE thread_id = t.id)) AS replies`;
const THREADS = `SELECT ${THREAD_COLUMNS} FROM threads t LEFT JOIN members m ON m.id = t.author_id`;
const POSTS = `SELECT p.*, m.name AS author_name, m.role AS author_role FROM posts p LEFT JOIN members m ON m.id = p.author_id`;

/** Line endings made plain, edges trimmed, and runs of blank lines kept to one. */
export const tidy = (body: string) =>
  body
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Every operation on the community board. Members and admins act through it; the database is passed in for tests. */
export function createCommunity(db: Db, now: () => Date = () => new Date()) {
  const threadRow = (id: number) => db.prepare(`${THREADS} WHERE t.id = ? AND t.removed_at IS NULL`).get(id);
  const since = () => iso(new Date(now().getTime() - DUPLICATE_WINDOW_MS));

  const place = (threadId: number, channel: ChannelSlug, postId: number): PostPlace => ({
    threadId,
    channel,
    postId,
    position: count(db.prepare('SELECT count(*) AS n FROM posts WHERE thread_id = ? AND id <= ?').get(threadId, postId)),
  });

  /** A post in a thread that is still up, with the thread's lock state. Every post-level operation starts here. */
  const livePost = (postId: number, refuse: (reason: PostRefusal) => never) => {
    const row = db
      .prepare('SELECT p.*, t.channel, t.locked FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ? AND t.removed_at IS NULL')
      .get(postId);
    if (!row) return refuse('not-found');
    return {
      threadId: integer(row, 'thread_id'),
      authorId: row['author_id'] === null ? null : integer(row, 'author_id'),
      deleted: optionalText(row, 'deleted_at') !== null,
      channel: oneOf(row, 'channel', channelSlugs),
      locked: integer(row, 'locked') === 1,
    };
  };

  /** The rule for an empty thread: once no post in it is left undeleted, the thread is gone. */
  const removeIfEmpty = (threadId: number): boolean => {
    if (count(db.prepare('SELECT count(*) AS n FROM posts WHERE thread_id = ? AND deleted_at IS NULL').get(threadId)) > 0) return false;
    db.prepare('UPDATE threads SET removed_at = ? WHERE id = ? AND removed_at IS NULL').run(iso(now()), threadId);
    return true;
  };

  return {
    channels(): ChannelSummary[] {
      return channels.map(({ slug }) => {
        const latest = db.prepare(`${THREADS} WHERE t.channel = ? AND t.removed_at IS NULL ORDER BY t.last_post_at DESC, t.id DESC LIMIT 1`).get(slug);
        return {
          slug,
          threads: count(db.prepare('SELECT count(*) AS n FROM threads WHERE channel = ? AND removed_at IS NULL').get(slug)),
          latest: latest ? toThread(latest) : null,
        };
      });
    },

    /** One page of a channel: pinned threads first, then the most recently active. */
    threads(channel: ChannelSlug, page: { limit: number; offset: number }): { items: Thread[]; total: number } {
      return {
        items: db
          .prepare(`${THREADS} WHERE t.channel = ? AND t.removed_at IS NULL ORDER BY t.pinned DESC, t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`)
          .all(channel, page.limit, page.offset)
          .map(toThread),
        total: count(db.prepare('SELECT count(*) AS n FROM threads WHERE channel = ? AND removed_at IS NULL').get(channel)),
      };
    },

    recent(limit: number): Thread[] {
      return db.prepare(`${THREADS} WHERE t.removed_at IS NULL ORDER BY t.last_post_at DESC, t.id DESC LIMIT ?`).all(limit).map(toThread);
    },

    thread(id: number): Thread | null {
      const row = threadRow(id);
      return row ? toThread(row) : null;
    },

    posts(threadId: number, page: { limit: number; offset: number }): { items: Post[]; total: number } {
      return {
        items: db.prepare(`${POSTS} WHERE p.thread_id = ? ORDER BY p.id LIMIT ? OFFSET ?`).all(threadId, page.limit, page.offset).map(toPost),
        total: count(db.prepare('SELECT count(*) AS n FROM posts WHERE thread_id = ?').get(threadId)),
      };
    },

    postCount(memberId: number): number {
      return count(
        db
          .prepare('SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.author_id = ? AND p.deleted_at IS NULL AND t.removed_at IS NULL')
          .get(memberId),
      );
    },

    /** Opens a thread with its first post. Submitting the same title twice within a minute returns the first thread. */
    startThread(actor: Actor, input: { channel: ChannelSlug; title: string; body: string }): PostPlace {
      return db.transaction(() => {
        const title = input.title.trim();
        const body = tidy(input.body);
        const repeat = db
          .prepare(
            `SELECT t.id, (SELECT min(id) FROM posts WHERE thread_id = t.id) AS post_id FROM threads t
             WHERE t.author_id = ? AND t.channel = ? AND t.title = ? AND t.created_at >= ? AND t.removed_at IS NULL`,
          )
          .get(actor.id, input.channel, title, since());
        if (repeat) return place(integer(repeat, 'id'), input.channel, integer(repeat, 'post_id'));
        const at = iso(now());
        const thread = db
          .prepare('INSERT INTO threads (channel, title, author_id, created_at, last_post_at) VALUES (?, ?, ?, ?, ?)')
          .run(input.channel, title, actor.id, at, at);
        const threadId = thread.lastInsertRowid;
        const post = db.prepare('INSERT INTO posts (thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(threadId, actor.id, body, at);
        return place(threadId, input.channel, post.lastInsertRowid);
      });
    },

    /** What happened on the board since a moment: the threads started, and the replies posted anywhere. */
    since(moment: Date): { readonly threads: Thread[]; readonly replies: number } {
      const from = iso(moment);
      return {
        threads: db.prepare(`${THREADS} WHERE t.created_at >= ? AND t.removed_at IS NULL ORDER BY t.created_at`).all(from).map(toThread),
        replies: count(
          db
            .prepare(
              `SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id
               WHERE p.created_at >= ? AND p.deleted_at IS NULL AND t.removed_at IS NULL AND p.id > (SELECT min(id) FROM posts WHERE thread_id = t.id)`,
            )
            .get(from),
        ),
      };
    },

    /**
     * Adds a post, and records who is told of it. A locked thread takes replies only from admins. The same text twice
     * within a minute posts once.
     */
    reply(actor: Actor, threadId: number, input: { body: string }): Result<PostPlace & { readonly notices: ReplyNotices }, PostRefusal> {
      return attempt<PostPlace & { readonly notices: ReplyNotices }, PostRefusal>(db, (refuse) => {
        const row = threadRow(threadId);
        if (!row) return refuse('not-found');
        const thread = toThread(row);
        if (thread.locked && actor.role !== 'admin') refuse('locked');
        const body = tidy(input.body);
        const repeat = db
          .prepare('SELECT id FROM posts WHERE thread_id = ? AND author_id = ? AND body = ? AND created_at >= ? AND deleted_at IS NULL')
          .get(threadId, actor.id, body, since());
        const at = now();
        const postId = repeat ? integer(repeat, 'id') : db.prepare('INSERT INTO posts (thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(threadId, actor.id, body, iso(at)).lastInsertRowid;
        if (!repeat) db.prepare('UPDATE threads SET last_post_at = ? WHERE id = ?').run(iso(at), threadId);
        return { ...place(threadId, thread.channel, postId), notices: noticeReply(db, at, threadId, actor.id) };
      });
    },

    /** Only the author edits their words; an admin moderates by deleting. Nobody edits a deleted post. */
    editPost(actor: Actor, postId: number, input: { body: string }): Result<PostPlace, PostRefusal> {
      return attempt<PostPlace, PostRefusal>(db, (refuse) => {
        const found = livePost(postId, refuse);
        if (found.deleted) refuse('not-found');
        if (found.authorId !== actor.id) refuse('forbidden');
        if (found.locked && actor.role !== 'admin') refuse('locked');
        db.prepare('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?').run(tidy(input.body), iso(now()), postId);
        return place(found.threadId, found.channel, postId);
      });
    },

    /** The author or an admin deletes a post. Its text is wiped; a placeholder keeps the conversation readable. */
    deletePost(actor: Actor, postId: number): Result<PostPlace & { threadRemoved: boolean }, PostRefusal> {
      return attempt<PostPlace & { threadRemoved: boolean }, PostRefusal>(db, (refuse) => {
        const found = livePost(postId, refuse);
        if (found.authorId !== actor.id && actor.role !== 'admin') refuse('forbidden');
        db.prepare(`UPDATE posts SET body = '', deleted_at = coalesce(deleted_at, ?) WHERE id = ?`).run(iso(now()), postId);
        return { ...place(found.threadId, found.channel, postId), threadRemoved: removeIfEmpty(found.threadId) };
      });
    },

    /** Admin only: pin or lock a thread, or take it down. Repeating a moderation changes nothing. */
    moderate(actor: Actor, threadId: number, action: Moderation): Result<{ threadId: number; channel: ChannelSlug }, PostRefusal> {
      return attempt<{ threadId: number; channel: ChannelSlug }, PostRefusal>(db, (refuse) => {
        if (actor.role !== 'admin') refuse('forbidden');
        const row = threadRow(threadId);
        if (!row) return refuse('not-found');
        const change = {
          pin: 'pinned = 1',
          unpin: 'pinned = 0',
          lock: 'locked = 1',
          unlock: 'locked = 0',
          remove: 'removed_at = coalesce(removed_at, ?)',
        } as const satisfies Record<Moderation, string>;
        const statement = db.prepare(`UPDATE threads SET ${change[action]} WHERE id = ?`);
        if (action === 'remove') statement.run(iso(now()), threadId);
        else statement.run(threadId);
        return { threadId, channel: toThread(row).channel };
      });
    },
  };
}

export type Community = ReturnType<typeof createCommunity>;
