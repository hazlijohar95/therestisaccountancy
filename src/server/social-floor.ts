import {
  FLOOR_LIMITS,
  POST_JURISDICTIONS,
  REPORT_REASON_IDS,
  REPORT_REASONS,
  REPORT_TARGETS,
  reasonsFor,
  ROOM_IDS,
  roomOf,
  ROOMS,
  type FeedFilter,
  type PostJurisdiction,
  type ReportReason,
  type ReportTarget,
  type RoomAccess,
  type RoomId,
  type RoomLock,
} from '../data/social.ts';
import { matcher } from '../lib/search.ts';
import { waitingOf, type Waiting } from '../lib/waiting.ts';
import { createBilling } from './billing.ts';
import { STATUS_SQL } from './club.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Param, type Row } from './db.ts';
import { replyLetter, type Letter } from './letters.ts';
import { noticeReply } from './mailings.ts';
import { socialUrl } from './paths.ts';
import { fail, ok, type Result } from './result.ts';
import { authorOf as readAuthor, claimFacts, mainCredential, normaliseHandle, sealedSql, sealOf, type Author } from './social-profiles.ts';
import { notify } from './social-notify.ts';

/*
 * The Floor: posts in rooms, replies, the accepted answer, corrections from sealed members, useful marks, and reports.
 * Every read goes through one rule of what a viewer may see: not removed, written by a member the public can see, and
 * in a room the viewer may open (the practitioners' room needs a ticked licence, the members' room a paid club
 * membership; the team opens both). Writes check the same rule, so nobody can reply to, mark or report what they cannot
 * read, and nobody is emailed about a room they can no longer open.
 */

/** Who is looking, as the Floor needs to know it. */
export interface Viewer {
  readonly memberId: number | null;
  /** Posting and replying need a handle. */
  readonly hasHandle: boolean;
  /** Members with the seal can mark their reply as a correction. */
  readonly sealed: boolean;
  /** A ticked licence, or the team: reads and posts in the practitioners' room. */
  readonly practitioner: boolean;
  /** Club membership paid or in grace, or the team: reads and posts in the members' room. */
  readonly club: boolean;
  readonly admin: boolean;
}

export interface PostCard {
  readonly id: number;
  readonly room: RoomId;
  readonly jurisdiction: PostJurisdiction;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly author: Author;
  readonly replies: number;
  readonly useful: number;
  readonly usefulByViewer: boolean;
  /** The accepted reply, while its author holds the seal: "Answered by a ticked ACCA · Member", or "a ticked member". */
  readonly answer: { readonly replyId: number; readonly credential: string } | null;
  /** The first reply a member with the seal marked as correcting the post. */
  readonly correction: { readonly replyId: number } | null;
  readonly mine: boolean;
  /** The author can still edit it: the first quarter hour. */
  readonly editable: boolean;
}

export interface ReplyCard {
  readonly id: number;
  readonly postId: number;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly author: Author;
  readonly useful: number;
  readonly usefulByViewer: boolean;
  readonly accepted: boolean;
  /** Marked as a correction by its author, who holds the seal now. */
  readonly correction: boolean;
  readonly mine: boolean;
  readonly editable: boolean;
}

export interface RoomSummary {
  readonly id: RoomId;
  readonly name: string;
  /** What shuts the room to this viewer, or null when they may open it. */
  readonly locked: RoomLock | null;
  readonly posts: number;
}

export interface FeedQuery {
  readonly room: RoomId | null;
  readonly filter: FeedFilter;
  readonly offset: number;
}

export interface FeedPage {
  readonly viewer: Viewer;
  readonly rooms: readonly RoomSummary[];
  /** The room asked for needs access this viewer lacks, and which. Nothing from it is listed. */
  readonly locked: RoomLock | null;
  readonly posts: readonly PostCard[];
  readonly total: number;
}

export type ThreadSort = 'top' | 'new';

export type ThreadView =
  | { readonly state: 'open'; readonly viewer: Viewer; readonly post: PostCard; readonly replies: readonly ReplyCard[] }
  | { readonly state: 'locked'; readonly viewer: Viewer; readonly room: RoomId; readonly locked: RoomLock };

export interface PostDraft {
  readonly room: RoomId;
  readonly jurisdiction: PostJurisdiction;
  readonly title: string;
  readonly body: string;
}

export type ReportAbout = { readonly target: 'post' | 'reply'; readonly id: number } | { readonly target: 'profile'; readonly handle: string };

export interface ReportedItem {
  readonly target: ReportTarget;
  readonly targetId: number;
  readonly member: { readonly id: number; readonly name: string; readonly handle: string | null };
  /** A post's title, the start of a reply, or a profile's headline. */
  readonly summary: string;
  /** Where to look, as a social path: /post/12#reply-40 or /@aina. */
  readonly path: string;
  /** Already removed by its author or the team, or off The List. */
  readonly gone: boolean;
  readonly reports: readonly { readonly reason: string; readonly note: string; readonly reporter: string | null; readonly createdAt: string }[];
}

/** The week on the Floor for the club's Monday email. */
export interface FloorDigest {
  readonly posts: readonly { readonly id: number; readonly title: string; readonly room: RoomId; readonly replies: number }[];
  readonly replies: number;
}

export type PostRefusal = 'no-handle' | 'needs-licence' | 'needs-club';
export type ReplyRefusal = 'not-found' | 'no-handle' | 'no-seal';
/** 'room-access': a post moves only between rooms open to the same people, so nothing written in one leaks to another. */
export type EditRefusal = 'not-found' | 'not-yours' | 'too-late' | 'room-access';
export type RemoveRefusal = 'not-found' | 'not-yours';
export type AcceptRefusal = 'not-found' | 'not-yours' | 'self';
export type UsefulRefusal = 'not-found' | 'self';
export type ReportRefusal = 'not-found' | 'self' | 'already';

const NEEDS = { licensed: 'needs-licence', club: 'needs-club' } as const satisfies Record<RoomLock, PostRefusal>;
const EDIT_MS = FLOOR_LIMITS.editMinutes * 60_000;
/** The Monday email lists this many posts at most, the most replied to first. */
const DIGEST_POSTS = 10;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const ACTIVE = (column: string) => `EXISTS (SELECT 1 FROM members WHERE id = ${column} AND ${STATUS_SQL.active})`;
/** Written by a member the public can see: active, with a handle. */
const PUBLIC = (column: string) => `${ACTIVE(column)} AND EXISTS (SELECT 1 FROM profiles WHERE member_id = ${column})`;
const LIVE_POST = `p.removed_at IS NULL AND ${PUBLIC('p.member_id')}`;
const VISIBLE_REPLY = (r: string) => `${r}.removed_at IS NULL AND ${PUBLIC(`${r}.member_id`)}`;
const excerpt = (body: string, length = 200) => (body.length > length ? `${body.slice(0, length).trimEnd()}…` : body);

const ANONYMOUS: Viewer = { memberId: null, hasHandle: false, sealed: false, practitioner: false, club: false, admin: false };
/** Any club member without a licence: what the Monday email may show, since it goes to every one of them. */
const CLUB_MEMBER: Viewer = { ...ANONYMOUS, club: true };

/** What shuts a room to this viewer, or null when they may open it. */
export function lockFor(viewer: Viewer, access: RoomAccess): RoomLock | null {
  if (access === 'anyone') return null;
  return (access === 'licensed' ? viewer.practitioner : viewer.club) ? null : access;
}

export function createSocialFloor(db: Db, now: () => Date = () => new Date()) {
  const billing = createBilling(db, now);

  const viewerOf = (memberId: number | null): Viewer => {
    if (memberId === null) return ANONYMOUS;
    const row = db.prepare(`SELECT m.role, p.handle FROM members m LEFT JOIN profiles p ON p.member_id = m.id WHERE m.id = ? AND ${STATUS_SQL.active}`).get(memberId);
    if (!row) return ANONYMOUS;
    const admin = text(row, 'role') === 'admin';
    const licensed = db.prepare(`SELECT 1 FROM claims WHERE member_id = ? AND kind = 'licence' AND state = 'ticked'`).get(memberId) !== undefined;
    return { memberId, hasHandle: optionalText(row, 'handle') !== null, sealed: sealOf(claimFacts(db, memberId)), practitioner: admin || licensed, club: billing.club(memberId), admin };
  };

  /** The rule for posts, as SQL on the alias p, with its parameters: live, and in a room this viewer may open. */
  const visiblePosts = (viewer: Viewer): { readonly sql: string; readonly params: Param[] } => {
    const shut: Param[] = ROOMS.filter((room) => lockFor(viewer, room.access) !== null).map((room) => room.id);
    return { sql: `${LIVE_POST}${shut.length ? ` AND p.room NOT IN (${shut.map(() => '?').join(', ')})` : ''}`, params: shut };
  };

  const authors = new Map<number, Author>();
  /** Authors are read once per call: track and seal come from their claims. */
  const authorOf = (memberId: number): Author => {
    const known = authors.get(memberId);
    if (known) return known;
    const found = readAuthor(db, memberId);
    authors.set(memberId, found);
    return found;
  };

  const editable = (memberId: number, viewer: Viewer, createdAt: string) => viewer.memberId === memberId && now().getTime() - new Date(createdAt).getTime() < EDIT_MS;

  const POST_COLUMNS = `p.*,
    (SELECT count(*) FROM floor_replies r WHERE r.post_id = p.id AND ${VISIBLE_REPLY('r')}) AS replies,
    (SELECT count(*) FROM useful u WHERE u.target = 'post' AND u.target_id = p.id) AS useful,
    EXISTS (SELECT 1 FROM useful u WHERE u.target = 'post' AND u.target_id = p.id AND u.member_id = ?) AS useful_by_viewer`;

  const toPost = (row: Row, viewer: Viewer): PostCard => {
    const id = integer(row, 'id');
    const memberId = integer(row, 'member_id');
    const accepted = db.prepare(`SELECT r.id, r.member_id FROM floor_replies r WHERE r.post_id = ? AND r.accepted = 1 AND ${VISIBLE_REPLY('r')}`).get(id);
    const credential = accepted && authorOf(integer(accepted, 'member_id')).sealed ? mainCredential(db, integer(accepted, 'member_id')) : null;
    const correction = db
      .prepare(`SELECT r.id, r.member_id FROM floor_replies r WHERE r.post_id = ? AND r.correction = 1 AND ${VISIBLE_REPLY('r')} ORDER BY r.created_at, r.id`)
      .all(id)
      .find((reply) => authorOf(integer(reply, 'member_id')).sealed);
    return {
      id,
      room: oneOf(row, 'room', ROOM_IDS),
      jurisdiction: oneOf(row, 'jurisdiction', POST_JURISDICTIONS),
      title: text(row, 'title'),
      body: text(row, 'body'),
      createdAt: text(row, 'created_at'),
      editedAt: optionalText(row, 'edited_at'),
      author: authorOf(memberId),
      replies: integer(row, 'replies'),
      useful: integer(row, 'useful'),
      usefulByViewer: integer(row, 'useful_by_viewer') === 1,
      answer: accepted && credential ? { replyId: integer(accepted, 'id'), credential } : null,
      correction: correction ? { replyId: integer(correction, 'id') } : null,
      mine: viewer.memberId === memberId,
      editable: editable(memberId, viewer, text(row, 'created_at')),
    };
  };

  /** One post the viewer may see, as a row with its counts. */
  const postRow = (viewer: Viewer, postId: number): Row | undefined => {
    const visible = visiblePosts(viewer);
    return db.prepare(`SELECT ${POST_COLUMNS} FROM floor_posts p WHERE p.id = ? AND ${visible.sql}`).get(viewer.memberId, postId, ...visible.params);
  };

  /** A reply the viewer may see, on a post they may see. */
  const replyRow = (viewer: Viewer, replyId: number): Row | undefined => {
    const visible = visiblePosts(viewer);
    return db
      .prepare(`SELECT r.*, p.member_id AS post_author FROM floor_replies r JOIN floor_posts p ON p.id = r.post_id WHERE r.id = ? AND ${VISIBLE_REPLY('r')} AND ${visible.sql}`)
      .get(replyId, ...visible.params);
  };

  const toReply = (row: Row, viewer: Viewer): ReplyCard => {
    const author = authorOf(integer(row, 'member_id'));
    return {
      id: integer(row, 'id'),
      postId: integer(row, 'post_id'),
      body: text(row, 'body'),
      createdAt: text(row, 'created_at'),
      editedAt: optionalText(row, 'edited_at'),
      author,
      useful: integer(row, 'useful'),
      usefulByViewer: integer(row, 'useful_by_viewer') === 1,
      accepted: integer(row, 'accepted') === 1,
      correction: integer(row, 'correction') === 1 && author.sealed,
      mine: viewer.memberId === author.memberId,
      editable: editable(author.memberId, viewer, text(row, 'created_at')),
    };
  };

  const usefulCount = (target: 'post' | 'reply', id: number) => count(db.prepare('SELECT count(*) AS n FROM useful WHERE target = ? AND target_id = ?').get(target, id));

  const reports = (): ReportedItem[] => {
    const rows = db
      .prepare(
        `SELECT r.*, rp.handle AS reporter_handle FROM reports r LEFT JOIN profiles rp ON rp.member_id = r.reporter_id
         WHERE r.state = 'open' ORDER BY r.created_at, r.id`,
      )
      .all();
    const items = new Map<string, { target: ReportTarget; targetId: number; memberId: number; reports: ReportedItem['reports'][number][] }>();
    for (const row of rows) {
      const target = oneOf(row, 'target', REPORT_TARGETS);
      const targetId = integer(row, 'target_id');
      const key = `${target}:${targetId}`;
      const item = items.get(key) ?? { target, targetId, memberId: integer(row, 'target_member_id'), reports: [] };
      const reason = oneOf(row, 'reason', REPORT_REASON_IDS);
      item.reports.push({
        reason: REPORT_REASONS.find((r) => r.id === reason)?.label ?? reason,
        note: text(row, 'note'),
        reporter: optionalText(row, 'reporter_handle'),
        createdAt: text(row, 'created_at'),
      });
      items.set(key, item);
    }
    return [...items.values()].map(({ target, targetId, memberId, reports }): ReportedItem => {
      const person = db.prepare('SELECT m.id, m.name, p.handle, p.headline, p.listed FROM members m LEFT JOIN profiles p ON p.member_id = m.id WHERE m.id = ?').get(memberId);
      const member = { id: memberId, name: person ? text(person, 'name') : 'Removed member', handle: person ? optionalText(person, 'handle') : null };
      if (target === 'profile') {
        const listed = person && person.listed !== null ? integer(person, 'listed') === 1 : false;
        return { target, targetId, member, summary: person ? (optionalText(person, 'headline') ?? '') : '', path: member.handle ? `/@${member.handle}` : '/', gone: !listed, reports };
      }
      const content =
        target === 'post'
          ? db.prepare('SELECT id AS post_id, title AS summary, removed_at FROM floor_posts WHERE id = ?').get(targetId)
          : db.prepare('SELECT post_id, body AS summary, removed_at FROM floor_replies WHERE id = ?').get(targetId);
      const postId = content ? integer(content, 'post_id') : 0;
      return {
        target,
        targetId,
        member,
        summary: content ? excerpt(text(content, 'summary')) : '',
        path: target === 'post' ? `/post/${postId}` : `/post/${postId}#reply-${targetId}`,
        gone: !content || optionalText(content, 'removed_at') !== null,
        reports,
      };
    });
  };

  return {
    viewer: viewerOf,

    /** A page of the Floor for this viewer: rooms with their counts, then posts, newest first. */
    feed(viewerId: number | null, query: FeedQuery): FeedPage {
      authors.clear();
      const viewer = viewerOf(viewerId);
      const visible = visiblePosts(viewer);
      const counted = new Map(
        db
          .prepare(`SELECT p.room, count(*) AS n FROM floor_posts p WHERE ${visible.sql} GROUP BY p.room`)
          .all(...visible.params)
          .map((row) => [text(row, 'room'), integer(row, 'n')]),
      );
      const rooms = ROOMS.map((room) => ({ id: room.id, name: room.name, locked: lockFor(viewer, room.access), posts: counted.get(room.id) ?? 0 }));
      const locked = query.room === null ? null : lockFor(viewer, roomOf(query.room).access);
      if (locked || (query.filter === 'following' && viewer.memberId === null)) return { viewer, rooms, locked, posts: [], total: 0 };

      const where = [visible.sql];
      const params: Param[] = [...visible.params];
      if (query.room) {
        where.push('p.room = ?');
        params.push(query.room);
      }
      if (query.filter === 'following') {
        where.push('p.member_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)');
        params.push(viewer.memberId);
      } else if (query.filter === 'ticked') {
        where.push(`EXISTS (SELECT 1 FROM floor_replies r WHERE r.post_id = p.id AND r.accepted = 1 AND ${VISIBLE_REPLY('r')} AND ${sealedSql('r.member_id')})`);
      } else if (query.filter !== 'all') {
        where.push('p.jurisdiction = ?');
        params.push(query.filter);
      }
      const clause = where.join(' AND ');
      const total = count(db.prepare(`SELECT count(*) AS n FROM floor_posts p WHERE ${clause}`).get(...params));
      const posts = db
        .prepare(`SELECT ${POST_COLUMNS} FROM floor_posts p WHERE ${clause} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`)
        .all(viewer.memberId, ...params, FLOOR_LIMITS.pageSize, query.offset)
        .map((row) => toPost(row, viewer));
      return { viewer, rooms, locked, posts, total };
    },

    /** A post and its replies: the accepted one first, then by useful marks or newest. Null when it is gone. */
    thread(viewerId: number | null, postId: number, sort: ThreadSort = 'top'): ThreadView | null {
      authors.clear();
      const viewer = viewerOf(viewerId);
      const row = postRow(viewer, postId);
      if (!row) {
        const hidden = db.prepare(`SELECT p.room FROM floor_posts p WHERE p.id = ? AND ${LIVE_POST}`).get(postId);
        if (!hidden) return null;
        const room = oneOf(hidden, 'room', ROOM_IDS);
        const locked = lockFor(viewer, roomOf(room).access);
        return locked ? { state: 'locked', viewer, room, locked } : null;
      }
      const order = sort === 'top' ? 'r.accepted DESC, useful DESC, r.created_at, r.id' : 'r.accepted DESC, r.created_at DESC, r.id DESC';
      const replies = db
        .prepare(
          `SELECT r.*,
             (SELECT count(*) FROM useful u WHERE u.target = 'reply' AND u.target_id = r.id) AS useful,
             EXISTS (SELECT 1 FROM useful u WHERE u.target = 'reply' AND u.target_id = r.id AND u.member_id = ?) AS useful_by_viewer
           FROM floor_replies r WHERE r.post_id = ? AND ${VISIBLE_REPLY('r')} ORDER BY ${order}`,
        )
        .all(viewer.memberId, postId)
        .map((reply) => toReply(reply, viewer));
      return { state: 'open', viewer, post: toPost(row, viewer), replies };
    },

    /** A member's latest posts that this viewer may see, for their profile. */
    recentPosts(viewerId: number | null, authorId: number, limit = 5): PostCard[] {
      authors.clear();
      const viewer = viewerOf(viewerId);
      const visible = visiblePosts(viewer);
      return db
        .prepare(`SELECT ${POST_COLUMNS} FROM floor_posts p WHERE p.member_id = ? AND ${visible.sql} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
        .all(viewer.memberId, authorId, ...visible.params, limit)
        .map((row) => toPost(row, viewer));
    },

    /** Posts this viewer may see where a word in the title or body starts with the query: five at most, newest first. */
    searchPosts(viewerId: number | null, query: string, limit = 5): { readonly id: number; readonly title: string; readonly room: RoomId }[] {
      const match = matcher(query);
      if (!match) return [];
      const visible = visiblePosts(viewerOf(viewerId));
      return db
        .prepare(`SELECT p.id, p.title, p.body, p.room FROM floor_posts p WHERE ${visible.sql} AND (p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\') ORDER BY p.created_at DESC, p.id DESC LIMIT 200`)
        .all(...visible.params, match.like, match.like)
        .filter((row) => match.test(text(row, 'title')) || match.test(text(row, 'body')))
        .slice(0, limit)
        .map((row) => ({ id: integer(row, 'id'), title: text(row, 'title'), room: oneOf(row, 'room', ROOM_IDS) }));
    },

    post(memberId: number, draft: PostDraft): Result<{ readonly id: number }, PostRefusal> {
      const viewer = viewerOf(memberId);
      if (!viewer.hasHandle) return fail('no-handle');
      const locked = lockFor(viewer, roomOf(draft.room).access);
      if (locked) return fail(NEEDS[locked]);
      const { lastInsertRowid } = db
        .prepare('INSERT INTO floor_posts (member_id, room, jurisdiction, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(memberId, draft.room, draft.jurisdiction, draft.title, draft.body, iso(now()));
      return ok({ id: lastInsertRowid });
    },

    /** The author changes their post, in its first quarter hour. */
    editPost(memberId: number, postId: number, draft: PostDraft): Result<{ readonly id: number }, EditRefusal> {
      return attempt<{ readonly id: number }, EditRefusal>(db, (refuse) => {
        const viewer = viewerOf(memberId);
        const row = postRow(viewer, postId) ?? refuse('not-found');
        if (integer(row, 'member_id') !== memberId) refuse('not-yours');
        if (!editable(memberId, viewer, text(row, 'created_at'))) refuse('too-late');
        if (roomOf(draft.room).access !== roomOf(oneOf(row, 'room', ROOM_IDS)).access) refuse('room-access');
        db.prepare('UPDATE floor_posts SET room = ?, jurisdiction = ?, title = ?, body = ?, edited_at = ? WHERE id = ?').run(
          draft.room,
          draft.jurisdiction,
          draft.title,
          draft.body,
          iso(now()),
          postId,
        );
        return { id: postId };
      });
    },

    /** The author deletes their post, or the team removes it. Its replies go with it. */
    removePost(actorId: number, postId: number): Result<{ readonly room: RoomId }, RemoveRefusal> {
      return attempt<{ readonly room: RoomId }, RemoveRefusal>(db, (refuse) => {
        const viewer = viewerOf(actorId);
        const row = postRow(viewer, postId) ?? refuse('not-found');
        if (integer(row, 'member_id') !== actorId && !viewer.admin) refuse('not-yours');
        db.prepare('UPDATE floor_posts SET removed_at = ?, removed_by = ? WHERE id = ?').run(iso(now()), actorId, postId);
        return { room: oneOf(row, 'room', ROOM_IDS) };
      });
    },

    /**
     * Replies to a post the member can see. Only a member with the seal can mark their reply as a correction. The post's
     * author is notified, and the letters to send tell the author and earlier repliers who still want them and can still
     * open the room. siteUrl is the club's address, for the links.
     */
    reply(
      memberId: number,
      postId: number,
      input: { readonly body: string; readonly correction: boolean },
      siteUrl: string,
    ): Result<{ readonly id: number; readonly letters: readonly Letter[] }, ReplyRefusal> {
      const viewer = viewerOf(memberId);
      const post = postRow(viewer, postId);
      if (!post) return fail('not-found');
      if (!viewer.hasHandle) return fail('no-handle');
      if (input.correction && !viewer.sealed) return fail('no-seal');
      return ok(
        db.transaction(() => {
          const at = now();
          const { lastInsertRowid: id } = db
            .prepare('INSERT INTO floor_replies (post_id, member_id, body, correction, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(postId, memberId, input.body, input.correction ? 1 : 0, iso(at));
          notify(db, at, integer(post, 'member_id'), { kind: 'reply', key: String(id), actorId: memberId, subjectId: postId });
          const recipients = noticeReply(db, at, postId, memberId, (recipientId) => postRow(viewerOf(recipientId), postId) !== undefined);
          const reply = { title: text(post, 'title'), by: readAuthor(db, memberId).name, url: socialUrl(siteUrl, `/post/${postId}#reply-${id}`), settingsUrl: new URL('/members/account#email', siteUrl).href };
          return { id, letters: recipients.map((to) => replyLetter(to, reply)) };
        }),
      );
    },

    editReply(memberId: number, replyId: number, body: string): Result<{ readonly postId: number }, EditRefusal> {
      return attempt<{ readonly postId: number }, EditRefusal>(db, (refuse) => {
        const viewer = viewerOf(memberId);
        const row = replyRow(viewer, replyId) ?? refuse('not-found');
        if (integer(row, 'member_id') !== memberId) refuse('not-yours');
        if (!editable(memberId, viewer, text(row, 'created_at'))) refuse('too-late');
        db.prepare('UPDATE floor_replies SET body = ?, edited_at = ? WHERE id = ?').run(body, iso(now()), replyId);
        return { postId: integer(row, 'post_id') };
      });
    },

    /** The author deletes their reply, or the team removes it. An accepted reply stops being the answer. */
    removeReply(actorId: number, replyId: number): Result<{ readonly postId: number }, RemoveRefusal> {
      return attempt<{ readonly postId: number }, RemoveRefusal>(db, (refuse) => {
        const viewer = viewerOf(actorId);
        const row = replyRow(viewer, replyId) ?? refuse('not-found');
        if (integer(row, 'member_id') !== actorId && !viewer.admin) refuse('not-yours');
        db.prepare('UPDATE floor_replies SET removed_at = ?, removed_by = ?, accepted = 0 WHERE id = ?').run(iso(now()), actorId, replyId);
        return { postId: integer(row, 'post_id') };
      });
    },

    /** The post's author picks the answer. Accepting another moves it; accepting the same one again changes nothing. */
    accept(memberId: number, replyId: number): Result<{ readonly postId: number }, AcceptRefusal> {
      return attempt<{ readonly postId: number }, AcceptRefusal>(db, (refuse) => {
        const row = replyRow(viewerOf(memberId), replyId) ?? refuse('not-found');
        if (integer(row, 'post_author') !== memberId) refuse('not-yours');
        if (integer(row, 'member_id') === memberId) refuse('self');
        const postId = integer(row, 'post_id');
        db.prepare('UPDATE floor_replies SET accepted = 0 WHERE post_id = ? AND accepted = 1 AND id != ?').run(postId, replyId);
        db.prepare('UPDATE floor_replies SET accepted = 1 WHERE id = ?').run(replyId);
        notify(db, now(), integer(row, 'member_id'), { kind: 'accepted', key: String(replyId), actorId: memberId, subjectId: postId });
        return { postId };
      });
    },

    unaccept(memberId: number, replyId: number): Result<{ readonly postId: number }, AcceptRefusal> {
      return attempt<{ readonly postId: number }, AcceptRefusal>(db, (refuse) => {
        const row = replyRow(viewerOf(memberId), replyId) ?? refuse('not-found');
        if (integer(row, 'post_author') !== memberId) refuse('not-yours');
        db.prepare('UPDATE floor_replies SET accepted = 0 WHERE id = ?').run(replyId);
        return { postId: integer(row, 'post_id') };
      });
    },

    /** One mark per member, never on their own words. Marking twice changes nothing. Returns the new count. */
    markUseful(memberId: number, target: 'post' | 'reply', id: number): Result<{ readonly useful: number }, UsefulRefusal> {
      const viewer = viewerOf(memberId);
      const row = target === 'post' ? postRow(viewer, id) : replyRow(viewer, id);
      if (!row) return fail('not-found');
      const owner = integer(row, 'member_id');
      if (owner === memberId) return fail('self');
      return ok(
        db.transaction(() => {
          db.prepare('INSERT INTO useful (member_id, target, target_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(memberId, target, id, iso(now()));
          const postId = target === 'post' ? id : integer(row, 'post_id');
          notify(db, now(), owner, { kind: 'useful', key: `${target}:${id}:${memberId}`, actorId: memberId, subjectId: postId, detail: target });
          return { useful: usefulCount(target, id) };
        }),
      );
    },

    unmarkUseful(memberId: number, target: 'post' | 'reply', id: number): Result<{ readonly useful: number }, 'not-found'> {
      const viewer = viewerOf(memberId);
      if (!(target === 'post' ? postRow(viewer, id) : replyRow(viewer, id))) return fail('not-found');
      db.prepare('DELETE FROM useful WHERE member_id = ? AND target = ? AND target_id = ?').run(memberId, target, id);
      return ok({ useful: usefulCount(target, id) });
    },

    /** A post's title, when this viewer may open it. Notifications name posts through this, so a closed room names nothing. */
    titleFor(viewer: Viewer, postId: number): string | null {
      const visible = visiblePosts(viewer);
      const row = db.prepare(`SELECT p.title FROM floor_posts p WHERE p.id = ? AND ${visible.sql}`).get(postId, ...visible.params);
      return row ? text(row, 'title') : null;
    },

    /** Posts and replies the member has up on the Floor, for the team's view of them. */
    postCount(memberId: number): number {
      return count(
        db
          .prepare(
            `SELECT (SELECT count(*) FROM floor_posts WHERE member_id = ? AND removed_at IS NULL)
                  + (SELECT count(*) FROM floor_replies WHERE member_id = ? AND removed_at IS NULL) AS n`,
          )
          .get(memberId, memberId),
      );
    },

    /**
     * The week on the Floor for the club's Monday email: posts since a moment in rooms every club member may open, never
     * the practitioners' room, the most replied to first, and how many replies were posted in those rooms.
     */
    digest(since: Date): FloorDigest {
      const visible = visiblePosts(CLUB_MEMBER);
      const from = iso(since);
      const posts = db
        .prepare(`SELECT ${POST_COLUMNS} FROM floor_posts p WHERE p.created_at >= ? AND ${visible.sql} ORDER BY replies DESC, p.created_at DESC, p.id DESC LIMIT ?`)
        .all(CLUB_MEMBER.memberId, from, ...visible.params, DIGEST_POSTS)
        .map((row) => ({ id: integer(row, 'id'), title: text(row, 'title'), room: oneOf(row, 'room', ROOM_IDS), replies: integer(row, 'replies') }));
      const replies = count(
        db.prepare(`SELECT count(*) AS n FROM floor_replies r JOIN floor_posts p ON p.id = r.post_id WHERE r.created_at >= ? AND ${VISIBLE_REPLY('r')} AND ${visible.sql}`).get(from, ...visible.params),
      );
      return { posts, replies };
    },

    /** A member reports something they can see. One open report each per thing; a person on the team reads it. */
    report(reporterId: number, about: ReportAbout, reason: ReportReason, note: string): Result<null, ReportRefusal> {
      if (!reasonsFor(about.target).some((allowed) => allowed.id === reason)) throw new TypeError(`${reason} is not a reason to report a ${about.target}`);
      const viewer = viewerOf(reporterId);
      const found =
        about.target === 'profile'
          ? db.prepare(`SELECT p.member_id FROM profiles p WHERE p.handle = ? AND ${ACTIVE('p.member_id')}`).get(normaliseHandle(about.handle))
          : (about.target === 'post' ? postRow(viewer, about.id) : replyRow(viewer, about.id));
      if (!found) return fail('not-found');
      const memberId = integer(found, 'member_id');
      if (memberId === reporterId) return fail('self');
      const targetId = about.target === 'profile' ? memberId : about.id;
      const { changes } = db
        .prepare(
          `INSERT INTO reports (reporter_id, target, target_id, target_member_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .run(reporterId, about.target, targetId, memberId, reason, note, iso(now()));
      return changes ? ok(null) : fail('already');
    },

    /** Open reports for the team, one entry per reported thing, the oldest report first. */
    reports,

    /** Reported things waiting for the team, counted as the queue shows them, one per thing, and since the oldest open report. */
    waiting: (): Waiting => {
      const items = reports();
      return { count: items.length, since: waitingOf(items.flatMap((i) => i.reports.map((r) => r.createdAt))).since };
    },

    /**
     * The team's decision on everything reported about one thing. Hide removes a post or reply, or takes a profile off
     * The List; dismiss leaves it. Either closes every open report on it.
     */
    decideReports(reviewerId: number, target: ReportTarget, targetId: number, verdict: 'hide' | 'dismiss'): Result<null, 'not-found'> {
      return attempt<null, 'not-found'>(db, (refuse) => {
        const open = db.prepare(`SELECT target_member_id FROM reports WHERE target = ? AND target_id = ? AND state = 'open'`).get(target, targetId) ?? refuse('not-found');
        if (verdict === 'hide') {
          const at = iso(now());
          if (target === 'post') db.prepare('UPDATE floor_posts SET removed_at = coalesce(removed_at, ?), removed_by = coalesce(removed_by, ?) WHERE id = ?').run(at, reviewerId, targetId);
          if (target === 'reply') db.prepare('UPDATE floor_replies SET removed_at = coalesce(removed_at, ?), removed_by = coalesce(removed_by, ?), accepted = 0 WHERE id = ?').run(at, reviewerId, targetId);
          if (target === 'profile') db.prepare('UPDATE profiles SET listed = 0, updated_at = ? WHERE member_id = ?').run(at, integer(open, 'target_member_id'));
        }
        db.prepare(`UPDATE reports SET state = ?, decided_at = ?, decided_by = ? WHERE target = ? AND target_id = ? AND state = 'open'`).run(
          verdict === 'hide' ? 'actioned' : 'dismissed',
          iso(now()),
          reviewerId,
          target,
          targetId,
        );
        return null;
      });
    },
  };
}

export type SocialFloor = ReturnType<typeof createSocialFloor>;
