import { ActionError, defineAction } from 'astro:actions';
import { getEntry } from 'astro:content';
import { z } from 'astro/zod';
import { joinSection } from '../data/club.ts';
import type { SignInRefusal } from '../server/club.ts';
import { getClub } from '../server/instance.ts';
import { email, mismatch, newPassword, passwordsMatch, settle, signedIn, startSession, type Refusal } from './guards.ts';

const signInRefusals: Record<SignInRefusal, Refusal> = {
  'no-match': { code: 'UNAUTHORIZED', message: 'That email and password do not match.' },
  suspended: { code: 'FORBIDDEN', message: 'Your membership is paused. Ask the club about it.' },
};

export const account = {
  join: defineAction({
    accept: 'form',
    input: z.object({
      name: z.string().trim().min(1, joinSection.messages.name).max(60),
      email,
      stage: z.enum(joinSection.stages),
    }),
    handler: (input) => {
      getClub().recordJoinRequest(input);
      return { email: input.email };
    },
  }),

  signIn: defineAction({
    accept: 'form',
    input: z.object({ email: z.string().trim(), password: z.string() }),
    handler: async (input, context) => {
      const access = settle(await getClub().authenticate(input.email, input.password), signInRefusals);
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
      const result = await getClub().setPasswordFromLink(input.token, input.password);
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
      const access = await getClub().changePassword(member.id, input.current, input.password);
      if (!access) throw new ActionError({ code: 'BAD_REQUEST', message: 'Your current password is wrong.' });
      await startSession(context, access.key);
      return { changed: true };
    },
  }),

  lessonDone: defineAction({
    accept: 'form',
    input: z.object({ lesson: z.string(), done: z.enum(['true', 'false']) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      if (!(await getEntry('lessons', input.lesson))) throw new ActionError({ code: 'NOT_FOUND', message: 'There is no such lesson.' });
      getClub().setLessonDone(member.id, input.lesson, input.done === 'true');
      return { done: input.done === 'true' };
    },
  }),
};
