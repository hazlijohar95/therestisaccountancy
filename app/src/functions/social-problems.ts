import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { OPTION_KEYS, POST_JURISDICTIONS, PROBLEM_LIMITS, RATING_IDS, TOPICS } from '../../../src/data/social.ts';
import type { AnswerRefusal, CreateRefusal, RateRefusal, RemoveProblemRefusal } from '../../../src/server/social-problems.ts';
import { blankable, id, line, malaysiaTime, oneLine } from '../lib/fields.ts';
import { adminOrRefusal, memberOrRefusal } from '../lib/guards.server.ts';
import { allowed, tooManyTries } from '../lib/limits.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * Problems: one a week, written by the team. Answers stay hidden until you answer or it closes; members with the seal
 * rate the reasoning while it is open.
 */

const createRefusals: Record<CreateRefusal, string> = {
  'number-taken': 'A problem already has that number. Pick another.',
  window: 'It has to close after it opens.',
  overlaps: 'Another problem is open then. Only one is open at a time.',
};
const removeRefusals: Record<RemoveProblemRefusal, string> = {
  'not-found': 'That problem is already gone.',
  answered: 'Someone has answered it, so it stays.',
};
const answerRefusals: Record<AnswerRefusal, string> = {
  'not-found': 'That problem is not open to you.',
  'not-open': 'That problem has closed. Its answers are open to read.',
  'no-handle': 'Claim your handle first. Answers show it.',
  already: 'You already answered this one.',
  'no-option': 'Pick one of the options.',
};
const rateRefusals: Record<RateRefusal, string> = {
  'not-found': 'Answer the problem first. Then you can rate.',
  'no-seal': 'Only members with the seal rate answers. Get ticked to rate.',
  self: 'You cannot rate your own answer.',
  closed: 'Ratings close with the problem.',
};

/** What sits beside every problem: the archive, when the next one opens, the viewer's streak, and whether they are the team. */
export const problemBoard = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  return withStore(async (store) => ({
    past: await store.socialProblems.archive(),
    next: await store.socialProblems.nextOpens(),
    streak: member ? await store.socialProblems.streak(member.id) : null,
    team: member?.role === 'admin',
    signedIn: member !== null,
  }));
});

/**
 * A problem as the viewer may see it: /problems is the open one, or none; /problems/12 is number 12, open or in the
 * archive, and a 404 when there is no such problem or it is not open to them yet.
 */
export const problemView = createServerFn({ method: 'GET' })
  .validator((input: { number: string | null }) => input)
  .handler(async ({ data }) => {
    const number = data.number === null ? null : /^[1-9]\d{0,8}$/.test(data.number) ? Number(data.number) : Number.NaN;
    if (Number.isNaN(number)) throw notFound();
    const member = await currentMember();
    const view = await withStore(async (store) => await store.socialProblems.view(member?.id ?? null, number));
    if (!view) {
      if (number !== null) throw notFound();
      return null;
    }
    return view;
  });

export const answerProblem = createServerFn({ method: 'POST' })
  .validator((input: { number: number; pick: string; reasoning: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ number: number }>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = parsed(
      z.object({
        number: id,
        pick: z.enum(OPTION_KEYS, 'Pick an answer first.'),
        reasoning: blankable(
          z
            .string()
            .transform((value) => value.replace(/\r\n?/g, '\n').trim())
            .pipe(z.string().max(PROBLEM_LIMITS.reasoning, `Keep your reasoning under ${PROBLEM_LIMITS.reasoning.toLocaleString('en-MY')} characters.`)),
        ),
      }),
      data,
    );
    if (!input.ok) return input;
    if (!(await allowed('answer'))) return refused(tooManyTries);
    const { number, pick, reasoning } = input.value;
    const answered = await withStore(async (store) => await store.socialProblems.answer(member.value.id, number, { pick, reasoning }));
    return answered.ok ? done({ number: answered.value.number }) : refused(answerRefusals[answered.reason]);
  });

/** Sets a rating, or takes it back with 'none'. The chip pressed is said back, so focus and the announcement stay on it. */
export const rateAnswer = createServerFn({ method: 'POST' })
  .validator((input: { answer: number; button: string; rating: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ answer: number; rating: string | null; button: string }>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = parsed(z.object({ answer: id, button: z.enum(RATING_IDS), rating: z.enum([...RATING_IDS, 'none']) }), data);
    if (!input.ok) return input;
    const { answer, button, rating } = input.value;
    const rated = await withStore(async (store) => await store.socialProblems.rate(member.value.id, answer, rating === 'none' ? null : rating));
    return rated.ok ? done({ answer: rated.value.answerId, rating: rated.value.rating, button }) : refused(rateRefusals[rated.reason]);
  });

const HOUR = 3_600_000;
const malaysian = (ms: number) => new Date(ms + 8 * HOUR).toISOString();

/** The team's page: every problem, the next free number, and the next free week as the form's starting dates. */
export const newProblemPage = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (member?.role !== 'admin') throw notFound();
  const { schedule, nextNumber } = await withStore(async (store) => ({ schedule: await store.socialProblems.schedule(), nextNumber: await store.socialProblems.nextNumber() }));
  /* From the next hour, or from when the latest problem closes if that is later. Shown in Malaysian time. */
  const latestClose = schedule[0] ? new Date(schedule[0].closesAt).getTime() : 0;
  const start = Math.max(Math.ceil(Date.now() / HOUR) * HOUR, latestClose);
  return { schedule, nextNumber, opens: malaysian(start), closes: malaysian(start + 7 * 24 * HOUR) };
});

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

const problemInput = z.object({
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
});

/** The form as typed: every field text, the scenario lines and options in order. */
type ProblemForm = Record<'number' | 'tag' | 'jurisdiction' | 'title' | 'ask' | 'opensDate' | 'opensTime' | 'closesDate' | 'closesTime', string> & {
  scenario: string[];
  options: string[];
};

export const writeProblem = createServerFn({ method: 'POST' })
  .validator((input: ProblemForm) => input)
  .handler(async ({ data }): Promise<Outcome<{ number: number }>> => {
    const team = await adminOrRefusal();
    if (!team.ok) return team;
    const input = parsed(problemInput, data);
    if (!input.ok) return input;
    const { opensDate, opensTime, closesDate, closesTime, ...draft } = input.value;
    const opensAt = malaysiaTime(opensDate, opensTime);
    const closesAt = malaysiaTime(closesDate, closesTime);
    if (!opensAt || !closesAt) return refused('That date or time does not exist.');
    const created = await withStore(async (store) => await store.socialProblems.create(team.value.id, { ...draft, opensAt, closesAt }));
    return created.ok ? done({ number: created.value.number }) : refused(createRefusals[created.reason]);
  });

export const removeProblem = createServerFn({ method: 'POST' })
  .validator((input: { number: number }) => input)
  .handler(async ({ data }): Promise<Outcome<{ number: number }>> => {
    const team = await adminOrRefusal();
    if (!team.ok) return team;
    const input = parsed(z.object({ number: id }), data);
    if (!input.ok) return input;
    const removed = await withStore(async (store) => await store.socialProblems.remove(input.value.number));
    return removed.ok ? done({ number: input.value.number }) : refused(removeRefusals[removed.reason]);
  });
