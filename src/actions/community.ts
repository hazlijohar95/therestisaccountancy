import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { isChannelSlug, LIMITS, PAGE_SIZE, threadPath, type ChannelSlug } from '../data/community.ts';
import { MODERATIONS, type PostPlace, type PostRefusal } from '../server/community.ts';
import { replyLetter } from '../server/letters.ts';
import { absolute, id, sendLater, settle, signedIn, type Refusal } from './guards.ts';

const postRefusals: Record<PostRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That post or thread is no longer here.' },
  locked: { code: 'CONFLICT', message: 'This thread is locked. Only admins can add to it.' },
  forbidden: { code: 'FORBIDDEN', message: 'Only the person who wrote that can change it.' },
};

const body = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  .max(LIMITS.body.max, `Keep it under ${LIMITS.body.max.toLocaleString('en-MY')} characters, or split it into two posts.`);
const title = z
  .string()
  .trim()
  .min(LIMITS.title.min, `Give the thread a title of at least ${LIMITS.title.min} characters.`)
  .max(LIMITS.title.max, `Keep the title under ${LIMITS.title.max} characters.`);
const channel = z.custom<ChannelSlug>((v) => typeof v === 'string' && isChannelSlug(v), 'Pick a channel.');

const moderationRefusals: Record<PostRefusal, Refusal> = {
  ...postRefusals,
  forbidden: { code: 'FORBIDDEN', message: 'Only a club admin can moderate threads.' },
};

/** Where to send the browser after a post: the page it sits on. */
const landing = <P extends PostPlace>(place: P) => ({ ...place, page: Math.ceil(place.position / PAGE_SIZE.posts) });

export const community = {
  startThread: defineAction({
    accept: 'form',
    input: z.object({ channel, title, body }),
    handler: async (input, context) => landing(await context.locals.community.startThread(signedIn(context.locals), input)),
  }),

  reply: defineAction({
    accept: 'form',
    input: z.object({ thread: id, body }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const landed = landing(settle(await context.locals.community.reply(member, input.thread, input), postRefusals));
      const { title, recipients } = await context.locals.mailings.replyNotices(landed.threadId, member.id);
      const url = absolute(context, `${threadPath(landed.threadId, landed.page)}#post-${landed.postId}`);
      const settingsUrl = absolute(context, '/members/account#email');
      sendLater(context, recipients.map((to) => replyLetter(to, { title, by: member.name, url, settingsUrl })));
      return landed;
    },
  }),

  editPost: defineAction({
    accept: 'form',
    input: z.object({ post: id, body }),
    handler: async (input, context) => landing(settle(await context.locals.community.editPost(signedIn(context.locals), input.post, input), postRefusals)),
  }),

  deletePost: defineAction({
    accept: 'form',
    input: z.object({ post: id }),
    handler: async (input, context) => landing(settle(await context.locals.community.deletePost(signedIn(context.locals), input.post), postRefusals)),
  }),

  moderateThread: defineAction({
    accept: 'form',
    input: z.object({ thread: id, action: z.enum(MODERATIONS) }),
    handler: async (input, context) => ({ ...settle(await context.locals.community.moderate(signedIn(context.locals), input.thread, input.action), moderationRefusals), action: input.action }),
  }),
};
