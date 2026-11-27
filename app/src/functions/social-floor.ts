import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { FEED_FILTERS, FLOOR_LIMITS, POST_JURISDICTIONS, reasonsFor, REPORT_NOTE_MAX, REPORT_REASON_IDS, REPORT_TARGETS, ROOM_IDS, ROOMS, type FeedFilter, type RoomId } from '../../../src/data/social.ts';
import { pageCount } from '../../../src/lib/paging.ts';
import { SEARCH_MAX } from '../../../src/lib/search.ts';
import type { AcceptRefusal, EditRefusal, PostRefusal, RemoveRefusal, ReplyRefusal, ReportRefusal, ThreadSort, UsefulRefusal } from '../../../src/server/social-floor.ts';
import { numberId, oneLine } from '../lib/fields.ts';
import { action } from '../lib/action.server.ts';
import { socialHref } from '../lib/links.ts';
import { absolute } from '../lib/mail.server.ts';
import { done } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * The Floor: the feed, a thread, and everything people do to posts and replies. Each write answers an Outcome, so the
 * page redraws in place. Refusal tables name every reason the store can give.
 */

const notFound = 'That is no longer on the Floor.';
const noHandle = 'Claim your handle first. Posts show it.';

const postRefusals: Record<PostRefusal, string> = {
  'no-handle': noHandle,
  'needs-licence': 'That room needs a practising tick. Pick another room.',
  'needs-club': 'That room is for club members. Pick another room.',
};
const replyRefusals: Record<ReplyRefusal, string> = {
  'not-found': notFound,
  'no-handle': noHandle,
  'no-seal': 'Only members with the seal can mark a correction. Post it as a reply.',
};
const editRefusals: Record<EditRefusal, string> = {
  'not-found': notFound,
  'not-yours': 'Only the author can edit that.',
  'too-late': `Edits close ${FLOOR_LIMITS.editMinutes} minutes after posting. Reply to add to it.`,
  'room-access': 'A post can only move to a room open to the same people. Delete it and post it in the other room instead.',
};
const removeRefusals: Record<RemoveRefusal, string> = { 'not-found': notFound, 'not-yours': 'Only the author or the team can delete that.' };
const acceptRefusals: Record<AcceptRefusal, string> = {
  'not-found': notFound,
  'not-yours': 'Only the person who asked can accept an answer.',
  self: 'You cannot accept your own reply.',
};
const usefulRefusals: Record<UsefulRefusal, string> = { 'not-found': notFound, self: 'You cannot mark your own words useful.' };
const reportRefusals: Record<ReportRefusal, string> = {
  'not-found': notFound,
  self: 'You cannot report yourself.',
  already: 'You already reported this. A person on the team reads every report.',
};

/** Text as typed, with Windows line ends made plain and the ends trimmed. Line breaks inside stay. */
const prose = (min: number, empty: string) =>
  z
    .string(empty)
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().min(min, empty).max(FLOOR_LIMITS.body, `Keep it under ${FLOOR_LIMITS.body.toLocaleString('en-MY')} characters.`));

const postFields = {
  room: z.enum(ROOM_IDS, 'Pick a room.'),
  jurisdiction: z.enum(POST_JURISDICTIONS, 'Pick the jurisdiction. Tax answers change at the border.'),
  title: z
    .string('Write a title.')
    .transform(oneLine)
    .pipe(z.string().min(FLOOR_LIMITS.titleMin, `Write a title of at least ${FLOOR_LIMITS.titleMin} characters.`).max(FLOOR_LIMITS.title, `Keep the title under ${FLOOR_LIMITS.title} characters.`)),
  body: prose(0, ''),
};
const postSchema = z.object(postFields);
const editPostSchema = z.object({ post: numberId, ...postFields });
const replySchema = z.object({ post: numberId, body: prose(1, 'Write your reply first.'), correction: z.boolean() });
const editReplySchema = z.object({ reply: numberId, body: prose(1, 'Write your reply first.') });
const usefulSchema = z.object({ target: z.enum(['post', 'reply']), id: numberId });
const reportSchema = z
  .object({
    target: z.enum(REPORT_TARGETS),
    id: numberId.optional(),
    handle: z.string().optional(),
    reason: z.enum(REPORT_REASON_IDS, 'Pick what is wrong.'),
    note: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, '\n').trim())
      .pipe(z.string().max(REPORT_NOTE_MAX, `Keep it under ${REPORT_NOTE_MAX} characters.`)),
  })
  .superRefine((value, ctx) => {
    if (!reasonsFor(value.target).some((reason) => reason.id === value.reason)) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Pick what is wrong.' });
  });

/** The member's own avatar for the composer, when they have a handle. */
const ownAvatar = async (memberId: number) =>
  withStore(async (store) => {
    const own = await store.socialProfiles.ownProfile(memberId);
    return own && { name: own.name, track: own.track, sealed: own.sealed };
  });

export interface FloorQuery {
  readonly room: RoomId | null;
  readonly filter: FeedFilter;
  readonly page: number;
}

/** The Floor's feed for one room and filter, the week's problem, and the reader's own standing. */
export const floorPage = createServerFn({ method: 'GET' })
  .validator((input: FloorQuery) => input)
  .handler(async ({ data }) => {
    const member = await currentMember();
    const room = ROOMS.find((r) => r.id === data.room)?.id ?? null;
    const filter = FEED_FILTERS.find((f) => f.id === data.filter)?.id ?? 'all';
    const offset = (data.page - 1) * FLOOR_LIMITS.pageSize;
    const { feed, week } = await withStore(async (store) => {
      const feed = await store.socialFloor.feed(member?.id ?? null, { room, filter, offset });
      const view = await store.socialProblems.view(member?.id ?? null, null);
      return {
        feed: { rooms: feed.rooms, locked: feed.locked, posts: feed.posts, total: feed.total },
        week: view && { number: view.problem.number, tag: view.problem.tag, title: view.problem.title, answers: view.problem.answers, mine: view.mine !== null },
      };
    });
    const own = member ? await ownAvatar(member.id) : null;
    return { feed, pages: pageCount(feed.total, FLOOR_LIMITS.pageSize), week, signedIn: member !== null, own };
  });

/** A thread with its replies, sorted. Null when it is gone; locked when it is in a room the reader may not open. */
export const threadPage = createServerFn({ method: 'GET' })
  .validator((input: { id: number; sort: ThreadSort }) => input)
  .handler(async ({ data }) => {
    const member = await currentMember();
    if (!Number.isInteger(data.id) || data.id <= 0) return null;
    return withStore(async (store) => {
      const view = await store.socialFloor.thread(member?.id ?? null, data.id, data.sort);
      if (!view) return null;
      return view.state === 'locked'
        ? { state: 'locked' as const, signedIn: member !== null, room: view.room, locked: view.locked }
        : { state: 'open' as const, signedIn: member !== null, viewer: view.viewer, post: view.post, replies: view.replies };
    });
  });

export const floorPost = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof postSchema>) => input)
  .handler(
    action({ access: 'member', input: postSchema, limit: 'floor', refusals: postRefusals }, async ({ actor, input, store }) => {
      const result = await store.socialFloor.post(actor.id, input);
      return result.ok ? done({ id: result.value.id }) : result;
    }),
  );

export const editFloorPost = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof editPostSchema>) => input)
  .handler(
    action({ access: 'member', input: editPostSchema, refusals: editRefusals }, async ({ actor, input, store }) => {
      const { post, ...draft } = input;
      const result = await store.socialFloor.editPost(actor.id, post, draft);
      return result.ok ? done(null) : result;
    }),
  );

export const removeFloorPost = createServerFn({ method: 'POST' })
  .validator((input: { post: number }) => input)
  .handler(
    action({ access: 'member', input: z.object({ post: numberId }), refusals: removeRefusals }, async ({ actor, input, store }) => {
      const result = await store.socialFloor.removePost(actor.id, input.post);
      return result.ok ? done(null) : result;
    }),
  );

export const floorReply = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof replySchema>) => input)
  .handler(
    action({ access: 'member', input: replySchema, limit: 'floor', refusals: replyRefusals }, async ({ actor, input, store, send }) => {
      const result = await store.socialFloor.reply(actor.id, input.post, input, absolute('/'));
      if (!result.ok) return result;
      send(result.value.letters);
      return done({ id: result.value.id });
    }),
  );

export const editFloorReply = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof editReplySchema>) => input)
  .handler(
    action({ access: 'member', input: editReplySchema, refusals: editRefusals }, async ({ actor, input, store }) => {
      const result = await store.socialFloor.editReply(actor.id, input.reply, input.body);
      return result.ok ? done(null) : result;
    }),
  );

export const removeFloorReply = createServerFn({ method: 'POST' })
  .validator((input: { reply: number }) => input)
  .handler(
    action({ access: 'member', input: z.object({ reply: numberId }), refusals: removeRefusals }, async ({ actor, input, store }) => {
      const result = await store.socialFloor.removeReply(actor.id, input.reply);
      return result.ok ? done(null) : result;
    }),
  );

export const acceptReply = createServerFn({ method: 'POST' })
  .validator((input: { reply: number }) => input)
  .handler(
    action({ access: 'member', input: z.object({ reply: numberId }), refusals: acceptRefusals }, async ({ actor, input, store }) => {
      const result = await store.socialFloor.accept(actor.id, input.reply);
      return result.ok ? done(null) : result;
    }),
  );

export const unacceptReply = createServerFn({ method: 'POST' })
  .validator((input: { reply: number }) => input)
  .handler(
    action({ access: 'member', input: z.object({ reply: numberId }), refusals: acceptRefusals }, async ({ actor, input, store }) => {
      const result = await store.socialFloor.unaccept(actor.id, input.reply);
      return result.ok ? done(null) : result;
    }),
  );

export const markUseful = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof usefulSchema>) => input)
  .handler(
    action({ access: 'member', input: usefulSchema, refusals: usefulRefusals }, async ({ actor, input, store }) => {
      const result = await store.socialFloor.markUseful(actor.id, input.target, input.id);
      return result.ok ? done({ useful: result.value.useful }) : result;
    }),
  );

export const unmarkUseful = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof usefulSchema>) => input)
  .handler(
    action({ access: 'member', input: usefulSchema, refusals: { 'not-found': notFound } }, async ({ actor, input, store }) => {
      const result = await store.socialFloor.unmarkUseful(actor.id, input.target, input.id);
      return result.ok ? done({ useful: result.value.useful }) : result;
    }),
  );

/** A report on a post, a reply or a profile. A person on the team reads every one. */
export const report = createServerFn({ method: 'POST' })
  .validator((input: { target: z.input<typeof reportSchema>['target']; id?: number | undefined; handle?: string | undefined; reason: string; note: string }) => input)
  .handler(
    action({ access: 'member', input: reportSchema, limit: 'report', refusals: reportRefusals }, async ({ actor, input, store }) => {
      const { target, reason, note } = input;
      const about = target === 'profile' ? { target, handle: input.handle ?? '' } : { target, id: input.id ?? 0 };
      const result = await store.socialFloor.report(actor.id, about, reason, note);
      return result.ok ? done(null) : result;
    }),
  );

/**
 * People and posts for a search, with links built for the host the page is on. The search page shows them, and the
 * header's dialog reads the same shape as JSON.
 */
export const searchResults = createServerFn({ method: 'GET' })
  .validator((query: string) => query.slice(0, SEARCH_MAX))
  .handler(async ({ data: query }) => {
    const member = await currentMember();
    if (!query.trim()) return { query, people: [], posts: [] };
    return withStore(async (store) => {
      const people = await store.socialProfiles.search(query);
      const posts = await store.socialFloor.searchPosts(member?.id ?? null, query);
      return {
        query,
        people: people.map((p) => ({ href: socialHref(`/@${p.handle}`), name: p.name, handle: p.handle, topics: p.topics, track: p.track, sealed: p.sealed })),
        posts: posts.map((p) => ({ href: socialHref(`/post/${p.id}`), title: p.title })),
      };
    });
  });
