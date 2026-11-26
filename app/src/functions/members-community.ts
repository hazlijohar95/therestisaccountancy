import { createServerFn } from '@tanstack/react-start';
import { notFound, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { isChannelSlug, LIMITS, PAGE_SIZE, threadPath, channelBySlug, type ChannelSlug } from '../../../src/data/community.ts';
import { MODERATIONS, tidy, type Author, type Moderation, type Post, type PostPlace, type PostRefusal, type Thread } from '../../../src/server/community.ts';
import { replyLetter } from '../../../src/server/letters.ts';
import { memberOrRefusal, paidOrRefusal } from '../lib/guards.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { paidMemberOrRedirect } from '../lib/members.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

/** The refusal for a post or thread that has gone. A page whose thread went with it sends the member back to the board. */
export const GONE = 'That post or thread is no longer here.';

const postRefusals: Record<PostRefusal, string> = {
  'not-found': GONE,
  locked: 'This thread is locked. Only admins can add to it.',
  forbidden: 'Only the person who wrote that can change it.',
};
const moderationRefusals: Record<PostRefusal, string> = { ...postRefusals, forbidden: 'Only a club admin can moderate threads.' };

/* Plain copies of what the store answers, for the page. */
const plainAuthor = (author: Author | null): Author | null => author && { id: author.id, name: author.name, role: author.role };
const plainThread = (t: Thread): Thread => ({
  id: t.id,
  channel: t.channel,
  title: t.title,
  author: plainAuthor(t.author),
  createdAt: t.createdAt,
  lastPostAt: t.lastPostAt,
  replies: t.replies,
  pinned: t.pinned,
  locked: t.locked,
});
const plainPost = (p: Post): Post => ({ id: p.id, threadId: p.threadId, author: plainAuthor(p.author), body: p.body, createdAt: p.createdAt, editedAt: p.editedAt, deleted: p.deleted });

/** Far beyond any real list, and small enough that the offset stays a safe integer for SQLite. */
const MAX_PAGE = 1_000_000;
/** The page asked for, from 1. Anything else reads as the first page; anything huge, as MAX_PAGE. */
const pageOf = (asked: number | undefined) => (asked !== undefined && Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_PAGE) : 1);
const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

const RECENT = 10;

export const membersCommunity = createServerFn({ method: 'GET' }).handler(async () => {
  await paidMemberOrRedirect();
  return withStore(async (store) => {
    const summaries = (await store.community.channels()).map(({ slug, threads, latest }) => ({ slug, threads, latest: latest && { title: latest.title, lastPostAt: latest.lastPostAt } }));
    const recent = (await store.community.recent(RECENT)).map(plainThread);
    return { summaries, recent };
  });
});

/** A page of a channel's threads. A page past the last sends the member to the last. */
export const membersChannel = createServerFn({ method: 'GET' })
  .validator((input: { channel: string; page: number | undefined; query: string }) => input)
  .handler(async ({ data }) => {
    await paidMemberOrRedirect();
    const channel = channelBySlug(data.channel);
    if (!channel) throw notFound();
    const page = pageOf(data.page);
    const { items, total } = await withStore(async (store) => {
      const found = await store.community.threads(channel.slug, { limit: PAGE_SIZE.threads, offset: (page - 1) * PAGE_SIZE.threads });
      return { items: found.items.map(plainThread), total: found.total };
    });
    const pages = pageCount(total, PAGE_SIZE.threads);
    if (page > pages) throw redirect({ href: pageAt(`/members/community/${channel.slug}`, data.query, pages) });
    return { channel: { slug: channel.slug, name: channel.name, about: channel.about }, threads: items, page, pages };
  });

/** The same address on another page, keeping the rest of its query. */
function pageAt(pathname: string, query: string, page: number): string {
  const search = new URLSearchParams(query);
  if (page <= 1) search.delete('page');
  else search.set('page', String(page));
  const rest = search.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** A page of a thread's posts, with who is reading: their own posts can be edited. */
export const membersThread = createServerFn({ method: 'GET' })
  .validator((input: { id: string; page: number | undefined; query: string }) => input)
  .handler(async ({ data }) => {
    const member = await paidMemberOrRedirect();
    const id = Number(data.id);
    const page = pageOf(data.page);
    const found = Number.isInteger(id)
      ? await withStore(async (store) => {
          const thread = await store.community.thread(id);
          if (!thread) return null;
          const posts = await store.community.posts(thread.id, { limit: PAGE_SIZE.posts, offset: (page - 1) * PAGE_SIZE.posts });
          return { thread: plainThread(thread), posts: posts.items.map(plainPost), total: posts.total };
        })
      : null;
    if (!found) throw notFound();
    const pages = pageCount(found.total, PAGE_SIZE.posts);
    if (page > pages) throw redirect({ href: pageAt(`/members/community/threads/${found.thread.id}`, data.query, pages) });
    return { me: { id: member.id, role: member.role }, thread: found.thread, posts: found.posts, page, pages };
  });

const body = z
  .string()
  .transform(tidy)
  .pipe(z.string().min(1, 'Write something first.').max(LIMITS.body.max, `Keep it under ${LIMITS.body.max.toLocaleString('en-MY')} characters, or split it into two posts.`));
const title = z
  .string()
  .trim()
  .min(LIMITS.title.min, `Give the thread a title of at least ${LIMITS.title.min} characters.`)
  .max(LIMITS.title.max, `Keep the title under ${LIMITS.title.max} characters.`);
const channel = z.custom<ChannelSlug>((v) => typeof v === 'string' && isChannelSlug(v), 'Pick a channel.');
const id = z.number().int().positive();

/** Where to send the browser after a post: the page it sits on, at the post. */
export interface Landing {
  readonly threadId: number;
  readonly channel: ChannelSlug;
  readonly postId: number;
  readonly page: number;
}
const landing = (place: PostPlace): Landing => ({ threadId: place.threadId, channel: place.channel, postId: place.postId, page: Math.ceil(place.position / PAGE_SIZE.posts) });
export const landingHref = (at: Landing) => `${threadPath(at.threadId, at.page)}#post-${at.postId}`;

const startInput = z.object({ channel, title, body });

export const startThread = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof startInput>) => input)
  .handler(async ({ data }): Promise<Outcome<Landing>> => {
    const input = parsed(startInput, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    return done(landing(await withStore(async (store) => store.community.startThread(member.value, input.value))));
  });

const replyInput = z.object({ thread: id, body });

export const reply = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof replyInput>) => input)
  .handler(async ({ data }): Promise<Outcome<Landing>> => {
    const input = parsed(replyInput, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    const result = await withStore(async (store) => {
      const posted = await store.community.reply(member.value, input.value.thread, input.value);
      if (!posted.ok) return posted;
      const notices = await store.mailings.replyNotices(posted.value.threadId, member.value.id);
      return { ok: true as const, place: landing(posted.value), title: notices.title, recipients: [...notices.recipients] };
    });
    if (!result.ok) return refused(postRefusals[result.reason]);
    const url = absolute(landingHref(result.place));
    const settingsUrl = absolute('/members/account#email');
    sendLater(result.recipients.map((to) => replyLetter(to, { title: result.title, by: member.value.name, url, settingsUrl })));
    return done(result.place);
  });

const editInput = z.object({ post: id, body });

export const editPost = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof editInput>) => input)
  .handler(async ({ data }): Promise<Outcome<Landing>> => {
    const input = parsed(editInput, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    const edited = await withStore(async (store) => store.community.editPost(member.value, input.value.post, input.value));
    return edited.ok ? done(landing(edited.value)) : refused(postRefusals[edited.reason]);
  });

const deleteInput = z.object({ post: id });

export const deletePost = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof deleteInput>) => input)
  .handler(async ({ data }): Promise<Outcome<Landing & { threadRemoved: boolean }>> => {
    const input = parsed(deleteInput, data);
    if (!input.ok) return input;
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const deleted = await withStore(async (store) => store.community.deletePost(member.value, input.value.post));
    return deleted.ok ? done({ ...landing(deleted.value), threadRemoved: deleted.value.threadRemoved }) : refused(postRefusals[deleted.reason]);
  });

const moderateInput = z.object({ thread: id, action: z.enum(MODERATIONS) });

export const moderateThread = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof moderateInput>) => input)
  .handler(async ({ data }): Promise<Outcome<{ threadId: number; channel: ChannelSlug; action: Moderation }>> => {
    const input = parsed(moderateInput, data);
    if (!input.ok) return input;
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const moderated = await withStore(async (store) => store.community.moderate(member.value, input.value.thread, input.value.action));
    return moderated.ok ? done({ threadId: moderated.value.threadId, channel: moderated.value.channel, action: input.value.action }) : refused(moderationRefusals[moderated.reason]);
  });
