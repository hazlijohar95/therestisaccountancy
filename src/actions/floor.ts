import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { FLOOR_LIMITS, POST_JURISDICTIONS, reasonsFor, REPORT_NOTE_MAX, REPORT_REASON_IDS, REPORT_TARGETS, ROOM_IDS } from '../data/social.ts';
import type { AcceptRefusal, EditRefusal, PostRefusal, RemoveRefusal, ReplyRefusal, ReportRefusal, UsefulRefusal } from '../server/social-floor.ts';
import { admin, id, oneLine, settle, signedIn, throttle, type Refusal } from './guards.ts';

const notFound: Refusal = { code: 'NOT_FOUND', message: 'That is no longer on the Floor.' };
const noHandle: Refusal = { code: 'BAD_REQUEST', message: 'Claim your handle first. Posts show it.' };
const roomLocked: Refusal = { code: 'FORBIDDEN', message: 'That room needs a practising tick. Pick another room.' };

const postRefusals: Record<PostRefusal, Refusal> = { 'no-handle': noHandle, 'room-locked': roomLocked };
const replyRefusals: Record<ReplyRefusal, Refusal> = {
  'not-found': notFound,
  'no-handle': noHandle,
  'no-seal': { code: 'FORBIDDEN', message: 'Only members with the seal can mark a correction. Post it as a reply.' },
};
const editRefusals: Record<EditRefusal, Refusal> = {
  'not-found': notFound,
  'not-yours': { code: 'FORBIDDEN', message: 'Only the author can edit that.' },
  'too-late': { code: 'FORBIDDEN', message: `Edits close ${FLOOR_LIMITS.editMinutes} minutes after posting. Reply to add to it.` },
  'room-locked': roomLocked,
};
const removeRefusals: Record<RemoveRefusal, Refusal> = { 'not-found': notFound, 'not-yours': { code: 'FORBIDDEN', message: 'Only the author or the team can delete that.' } };
const acceptRefusals: Record<AcceptRefusal, Refusal> = {
  'not-found': notFound,
  'not-yours': { code: 'FORBIDDEN', message: 'Only the person who asked can accept an answer.' },
  self: { code: 'BAD_REQUEST', message: 'You cannot accept your own reply.' },
};
const usefulRefusals: Record<UsefulRefusal, Refusal> = { 'not-found': notFound, self: { code: 'BAD_REQUEST', message: 'You cannot mark your own words useful.' } };
const reportRefusals: Record<ReportRefusal, Refusal> = {
  'not-found': notFound,
  self: { code: 'BAD_REQUEST', message: 'You cannot report yourself.' },
  already: { code: 'CONFLICT', message: 'You already reported this. A person on the team reads every report.' },
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
  /* Optional: a missing field is an empty body. Astro reads a default only on the field's outermost schema. */
  body: prose(0, '').default(''),
};

const target = z.enum(['post', 'reply']);

export const floor = {
  floorPost: defineAction({
    accept: 'form',
    input: z.object(postFields),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'floor');
      return settle(await context.locals.socialFloor.post(member.id, input), postRefusals);
    },
  }),

  editFloorPost: defineAction({
    accept: 'form',
    input: z.object({ post: id, ...postFields }),
    handler: async ({ post, ...draft }, context) => {
      const member = signedIn(context.locals);
      return settle(await context.locals.socialFloor.editPost(member.id, post, draft), editRefusals);
    },
  }),

  removeFloorPost: defineAction({
    accept: 'form',
    input: z.object({ post: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return settle(await context.locals.socialFloor.removePost(member.id, input.post), removeRefusals);
    },
  }),

  floorReply: defineAction({
    accept: 'form',
    input: z.object({ post: id, body: prose(1, 'Write your reply first.'), correction: z.boolean() }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'floor');
      return settle(await context.locals.socialFloor.reply(member.id, input.post, input), replyRefusals);
    },
  }),

  editFloorReply: defineAction({
    accept: 'form',
    input: z.object({ reply: id, body: prose(1, 'Write your reply first.') }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return { ...settle(await context.locals.socialFloor.editReply(member.id, input.reply, input.body), editRefusals), reply: input.reply };
    },
  }),

  removeFloorReply: defineAction({
    accept: 'form',
    input: z.object({ reply: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return settle(await context.locals.socialFloor.removeReply(member.id, input.reply), removeRefusals);
    },
  }),

  acceptReply: defineAction({
    accept: 'form',
    input: z.object({ reply: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return { ...settle(await context.locals.socialFloor.accept(member.id, input.reply), acceptRefusals), reply: input.reply, accepted: true };
    },
  }),

  unacceptReply: defineAction({
    accept: 'form',
    input: z.object({ reply: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return { ...settle(await context.locals.socialFloor.unaccept(member.id, input.reply), acceptRefusals), reply: input.reply, accepted: false };
    },
  }),

  markUseful: defineAction({
    accept: 'form',
    input: z.object({ target, id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const { useful } = settle(await context.locals.socialFloor.markUseful(member.id, input.target, input.id), usefulRefusals);
      return { target: input.target, id: input.id, useful, marked: true };
    },
  }),

  unmarkUseful: defineAction({
    accept: 'form',
    input: z.object({ target, id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const { useful } = await context.locals.socialFloor.unmarkUseful(member.id, input.target, input.id);
      return { target: input.target, id: input.id, useful, marked: false };
    },
  }),

  report: defineAction({
    accept: 'form',
    input: z
      .object({
        target: z.enum(REPORT_TARGETS),
        id: id.optional(),
        handle: z.string().optional(),
        reason: z.enum(REPORT_REASON_IDS, 'Pick what is wrong.'),
        note: z.string().transform((value) => value.replace(/\r\n?/g, '\n').trim()).pipe(z.string().max(REPORT_NOTE_MAX, `Keep it under ${REPORT_NOTE_MAX} characters.`)).default(''),
      })
      .superRefine((value, ctx) => {
        if (!reasonsFor(value.target).some((reason) => reason.id === value.reason)) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Pick what is wrong.' });
      }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'report');
      const about = input.target === 'profile' ? { target: input.target, handle: input.handle ?? '' } : { target: input.target, id: input.id ?? 0 };
      settle(await context.locals.socialFloor.report(member.id, about, input.reason, input.note), reportRefusals);
      return { target: input.target, id: input.id ?? null };
    },
  }),

  hideReported: defineAction({
    accept: 'form',
    input: z.object({ target: z.enum(REPORT_TARGETS), id }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      settle(await context.locals.socialFloor.decideReports(reviewer.id, input.target, input.id, 'hide'), { 'not-found': { code: 'CONFLICT', message: 'Someone on the team already decided that.' } });
      return { decided: 'hidden' as const };
    },
  }),

  dismissReported: defineAction({
    accept: 'form',
    input: z.object({ target: z.enum(REPORT_TARGETS), id }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      settle(await context.locals.socialFloor.decideReports(reviewer.id, input.target, input.id, 'dismiss'), { 'not-found': { code: 'CONFLICT', message: 'Someone on the team already decided that.' } });
      return { decided: 'dismissed' as const };
    },
  }),
};
