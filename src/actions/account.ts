import { ActionError, defineAction } from 'astro:actions';
import { getEntry } from 'astro:content';
import { z } from 'astro/zod';
import { joinSection } from '../data/club.ts';
import type { SignInRefusal } from '../server/club.ts';
import { joinRequestLetter, passwordLetter } from '../server/letters.ts';
import { send } from '../server/mail.ts';
import { email, mismatch, newPassword, oneLine, passwordsMatch, settle, shareable, signedIn, startSession, throttle, type Refusal } from './guards.ts';

const signInRefusals: Record<SignInRefusal, Refusal> = {
  'no-match': { code: 'UNAUTHORIZED', message: 'That email and password do not match.' },
  suspended: { code: 'FORBIDDEN', message: 'Your membership is paused. Ask the club about it.' },
};

export const account = {
  join: defineAction({
    accept: 'form',
    input: z.object({
      name: z.string().transform(oneLine).pipe(z.string().min(1, joinSection.messages.name).max(60)),
      email,
      stage: z.enum(joinSection.stages),
      /** A field people never see. Bots that fill every field get a thank-you and nothing is saved. */
      website: z.string().optional(),
    }),
    handler: async ({ website, ...request }, context) => {
      await throttle(context, 'join');
      if (website) return { email: request.email };
      const { club } = context.locals;
      if (await club.recordJoinRequest(request)) {
        const admins = await club.adminEmails();
        const adminUrl = new URL('/admin', context.site ?? context.url).href;
        if (admins.length) context.locals.cfContext.waitUntil(send(joinRequestLetter(admins, request, adminUrl)));
      }
      return { email: request.email };
    },
  }),

  /** Emails a password link to a member who asks. Answers the same whether or not the email belongs to anyone. */
  requestLink: defineAction({
    accept: 'form',
    input: z.object({ email }),
    handler: async (input, context) => {
      await throttle(context, 'link');
      const link = await context.locals.club.requestLink(input.email);
      if (link) context.locals.cfContext.waitUntil(send(passwordLetter(shareable(link, context))));
      return { email: input.email };
    },
  }),

  signIn: defineAction({
    accept: 'form',
    input: z.object({ email: z.string().trim(), password: z.string() }),
    handler: async (input, context) => {
      await throttle(context, 'sign-in');
      const access = settle(await context.locals.club.authenticate(input.email, input.password), signInRefusals);
      await startSession(context, access.key);
      return { role: access.member.role };
    },
  }),

  signOut: defineAction({
    accept: 'form',
    handler: (_input, context) => {
      context.session?.destroy();
      return { signedOut: true };
    },
  }),

  setPassword: defineAction({
    accept: 'form',
    input: z.object({ token: z.string().min(1), ...newPassword }).refine(passwordsMatch, mismatch),
    handler: async (input, context) => {
      const result = await context.locals.club.setPasswordFromLink(input.token, input.password);
      if (!result) throw new ActionError({ code: 'NOT_FOUND', message: 'This link has been used or has expired. Ask the club for a new one.' });
      await startSession(context, result.key);
      return { purpose: result.purpose };
    },
  }),

  changePassword: defineAction({
    accept: 'form',
    input: z.object({ current: z.string(), ...newPassword }).refine(passwordsMatch, mismatch),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const access = await context.locals.club.changePassword(member.id, input.current, input.password);
      if (!access) throw new ActionError({ code: 'BAD_REQUEST', message: 'Your current password is wrong.' });
      await startSession(context, access.key);
      return { changed: true };
    },
  }),

  setEmailPrefs: defineAction({
    accept: 'form',
    input: z.object({ replies: z.literal('on').optional(), digest: z.literal('on').optional() }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const prefs = { replies: input.replies === 'on', digest: input.digest === 'on' };
      await context.locals.mailings.setPrefs(member.id, prefs);
      return prefs;
    },
  }),

  lessonDone: defineAction({
    accept: 'form',
    input: z.object({ lesson: z.string(), done: z.enum(['true', 'false']) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      if (!(await getEntry('lessons', input.lesson))) throw new ActionError({ code: 'NOT_FOUND', message: 'There is no such lesson.' });
      await context.locals.club.setLessonDone(member.id, input.lesson, input.done === 'true');
      return { done: input.done === 'true' };
    },
  }),
};
