import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { PLAN_REPLY_MAX } from '../../../src/data/plan.ts';
import { capitalised, formatDay, formatMoment, numberWord } from '../../../src/lib/format.ts';
import { tidy } from '../../../src/server/community.ts';
import { planAnsweredLetter, waited, type ReplyRefusal } from '../../../src/server/plans.ts';
import { id } from '../lib/fields.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

const ANSWERED_SHOWN = 20;

const characters = (n: number) => n.toLocaleString('en-MY');

const replyRefusals: Record<ReplyRefusal, string> = {
  'not-found': 'That plan is no longer here, so your answer was not sent. The member may have been removed.',
  'not-sent': 'The member took that plan back to change it, so your answer was not sent. It comes back here when they send it again.',
  changed: 'The member changed this plan after you opened it, so your answer was not sent. Read it again. Your answer is still in the box.',
  answered: 'That plan has been answered already, so your answer was not sent.',
};

/** Plans waiting for an answer, the one waiting longest first, and the most recent answered. */
export const adminPlans = createServerFn({ method: 'GET' }).handler(async () => {
  await admit('admin', toClub);
  const { waiting, answered } = await withStore(async (store) => ({ waiting: await store.plans.waiting(), answered: await store.plans.answered(ANSWERED_SHOWN) }));
  const now = new Date();
  return {
    title: waiting.length === 0 ? 'No plans waiting.' : waiting.length === 1 ? 'One plan waiting.' : `${capitalised(numberWord(waiting.length))} plans waiting.`,
    waiting: waiting.map((p) => ({
      id: p.id,
      member: { id: p.member.id, name: p.member.name },
      sentAt: p.sentAt,
      sent: formatDay(p.sentAt),
      sentMoment: formatMoment(p.sentAt),
      waited: waited(p.sentAt, now),
      answers: p.answers,
    })),
    answered: answered.map((p) => ({
      id: p.id,
      member: { id: p.member.id, name: p.member.name },
      sent: formatDay(p.sentAt),
      answers: p.answers,
      reply: { text: p.reply.text, by: p.reply.by, at: p.reply.at, day: formatDay(p.reply.at) },
    })),
    answeredShown: ANSWERED_SHOWN,
    replyMax: PLAN_REPLY_MAX,
  };
});

const answer = z.object({
  plan: id,
  /** When the plan the host read was sent. A plan sent again since is not the one they answered. */
  sentAt: z.string(),
  reply: z
    .string()
    .transform(tidy)
    .pipe(z.string().min(1, 'Write your answer first.').max(PLAN_REPLY_MAX, `Keep the answer under ${characters(PLAN_REPLY_MAX)} characters.`)),
});

/** Answers a plan. The member gets it by email, from the host, and the plan closes. */
export const answerPlan = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof answer>) => input)
  .handler(
    action({ access: 'admin', input: answer, refusals: replyRefusals }, async ({ actor, input, store, send }) => {
      const result = await store.plans.reply(actor.id, { id: input.plan, sentAt: input.sentAt }, input.reply);
      if (!result.ok) return result;
      send([planAnsweredLetter(result.value, actor, absolute(`/members/plan/${result.value.id}`))]);
      return done(null);
    }),
  );
