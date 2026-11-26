import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { OPTION_KEYS, POST_JURISDICTIONS, PROBLEM_LIMITS, RATING_IDS, TOPICS } from '../data/social.ts';
import type { AnswerRefusal, CreateRefusal, RateRefusal, RemoveProblemRefusal } from '../server/social-problems.ts';
import { admin, id, oneLine, settle, signedIn, throttle, type Refusal } from './guards.ts';
import { malaysiaTime } from './sessions.ts';

const notFound: Refusal = { code: 'NOT_FOUND', message: 'That problem is not open to you.' };

const createRefusals: Record<CreateRefusal, Refusal> = {
  'number-taken': { code: 'CONFLICT', message: 'A problem already has that number. Pick another.' },
  window: { code: 'BAD_REQUEST', message: 'It has to close after it opens.' },
  overlaps: { code: 'CONFLICT', message: 'Another problem is open then. Only one is open at a time.' },
};
const removeRefusals: Record<RemoveProblemRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That problem is already gone.' },
  answered: { code: 'CONFLICT', message: 'Someone has answered it, so it stays.' },
};
const answerRefusals: Record<AnswerRefusal, Refusal> = {
  'not-found': notFound,
  'not-open': { code: 'FORBIDDEN', message: 'That problem has closed. Its answers are open to read.' },
  'no-handle': { code: 'BAD_REQUEST', message: 'Claim your handle first. Answers show it.' },
  already: { code: 'CONFLICT', message: 'You already answered this one.' },
  'no-option': { code: 'BAD_REQUEST', message: 'Pick one of the options.' },
};
const rateRefusals: Record<RateRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'Answer the problem first. Then you can rate.' },
  'no-seal': { code: 'FORBIDDEN', message: 'Only members with the seal rate answers. Get ticked to rate.' },
  self: { code: 'BAD_REQUEST', message: 'You cannot rate your own answer.' },
  closed: { code: 'FORBIDDEN', message: 'Ratings close with the problem.' },
};

const line = (max: number, empty: string) => z.string(empty).transform(oneLine).pipe(z.string().min(1, empty).max(max, `Keep it under ${max} characters.`));

/** A group of lines where some may be left blank: the filled ones, in order, between min and max of them. */
const lines = (limits: { readonly min: number; readonly max: number }, max: number, what: string) =>
  z
    .array(z.string())
    .transform((values) => values.map(oneLine).filter(Boolean))
    .pipe(
      z
        .array(z.string().max(max, `Keep each ${what} under ${max} characters.`))
        .min(limits.min, `Write at least ${limits.min} ${what}s.`)
        .max(limits.max, `Write at most ${limits.max} ${what}s.`),
    );

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time.');

export const problems = {
  writeProblem: defineAction({
    accept: 'form',
    input: z.object({
      number: z.coerce.number('Give it a number.').int('Give it a whole number.').positive('Give it a number above zero.'),
      tag: z.enum(TOPICS, 'Pick a topic.'),
      jurisdiction: z.enum(POST_JURISDICTIONS, 'Pick the jurisdiction.'),
      title: line(PROBLEM_LIMITS.title, 'Write a title.'),
      scenario: lines(PROBLEM_LIMITS.scenario, PROBLEM_LIMITS.line, 'scenario line'),
      ask: line(PROBLEM_LIMITS.ask, 'Write the question.'),
      options: lines(PROBLEM_LIMITS.options, PROBLEM_LIMITS.option, 'option'),
      opensDate: date,
      opensTime: time,
      closesDate: date,
      closesTime: time,
    }),
    handler: async ({ opensDate, opensTime, closesDate, closesTime, ...draft }, context) => {
      const team = admin(context.locals);
      const opensAt = malaysiaTime(opensDate, opensTime);
      const closesAt = malaysiaTime(closesDate, closesTime);
      if (!opensAt || !closesAt) throw new ActionError({ code: 'BAD_REQUEST', message: 'That date or time does not exist.' });
      return settle(await context.locals.socialProblems.create(team.id, { ...draft, opensAt, closesAt }), createRefusals);
    },
  }),

  removeProblem: defineAction({
    accept: 'form',
    input: z.object({ number: id }),
    handler: async (input, context) => {
      admin(context.locals);
      settle(await context.locals.socialProblems.remove(input.number), removeRefusals);
      return { number: input.number };
    },
  }),

  answerProblem: defineAction({
    accept: 'form',
    input: z.object({
      number: id,
      pick: z.enum(OPTION_KEYS, 'Pick an answer first.'),
      reasoning: z
        .string()
        .transform((value) => value.replace(/\r\n?/g, '\n').trim())
        .pipe(z.string().max(PROBLEM_LIMITS.reasoning, `Keep your reasoning under ${PROBLEM_LIMITS.reasoning.toLocaleString('en-MY')} characters.`))
        .default(''),
    }),
    handler: async ({ number, ...input }, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'answer');
      return settle(await context.locals.socialProblems.answer(member.id, number, input), answerRefusals);
    },
  }),

  rateAnswer: defineAction({
    accept: 'form',
    /* Each chip is its own form: button names the chip, rating what it sets. The pressed chip sets none, which takes the rating back. */
    input: z.object({ answer: id, button: z.enum(RATING_IDS), rating: z.enum([...RATING_IDS, 'none']) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const rated = settle(await context.locals.socialProblems.rate(member.id, input.answer, input.rating === 'none' ? null : input.rating), rateRefusals);
      return { answer: rated.answerId, rating: rated.rating, button: input.button };
    },
  }),
};
