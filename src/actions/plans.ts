import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { PLAN_ANSWER_MAX, PLAN_REPLY_MAX, planSections } from '../data/plan.ts';
import { tidy } from '../server/community.ts';
import { planAnsweredLetter, planSentLetter, type ReplyRefusal } from '../server/plans.ts';
import { absolute, admin, id, paidMember, sendLater, settle, type Refusal } from './guards.ts';

const characters = (n: number) => n.toLocaleString('en-MY');

/**
 * One field per section of the plan, named by its slug. Any may be blank, since a draft takes what is written so far.
 * Line endings are made plain before the length is counted: browsers send each line break as two characters.
 */
const planFields = z.object(
  Object.fromEntries(
    planSections.map(({ slug }) => [
      slug,
      z
        .string()
        .transform(tidy)
        .pipe(z.string().max(PLAN_ANSWER_MAX, `Keep this section under ${characters(PLAN_ANSWER_MAX)} characters.`))
        .optional(),
    ]),
  ),
);

const withTheHosts: Refusal = { code: 'CONFLICT', message: 'Your plan is with the hosts, so that was not saved. Take it back first to change it.' };

const replyRefusals: Record<ReplyRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That plan is no longer here, so your answer was not sent. The member may have been removed.' },
  'not-sent': { code: 'CONFLICT', message: 'The member took that plan back to change it, so your answer was not sent. It comes back here when they send it again.' },
  answered: { code: 'CONFLICT', message: 'That plan has been answered already, so your answer was not sent.' },
};

export const plans = {
  savePlan: defineAction({
    accept: 'form',
    input: planFields,
    handler: async (input, context) => {
      const member = await paidMember(context.locals);
      return { savedAt: settle(await context.locals.plans.save(member.id, input), { sent: withTheHosts }).updatedAt };
    },
  }),

  /** Saves the plan, and sends it when every section is written. A short one stays a draft, so nothing typed is lost. */
  sendPlan: defineAction({
    accept: 'form',
    input: planFields,
    handler: async (input, context) => {
      const member = await paidMember(context.locals);
      const { plan, changed } = settle(await context.locals.plans.send(member.id, input), { sent: withTheHosts });
      if (changed && plan.status === 'sent') {
        const admins = await context.locals.club.adminEmails();
        if (admins.length) sendLater(context, [planSentLetter(admins, plan, absolute(context, `/admin/plans#plan-${plan.id}`))]);
      }
      return { sent: plan.status === 'sent' };
    },
  }),

  takeBackPlan: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const member = await paidMember(context.locals);
      settle(await context.locals.plans.takeBack(member.id), {
        answered: { code: 'CONFLICT', message: 'A host has answered your plan already, so it can no longer be taken back.' },
      });
      return { back: true };
    },
  }),

  startPlan: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const member = await paidMember(context.locals);
      return { id: (await context.locals.plans.startNext(member.id)).id };
    },
  }),

  answerPlan: defineAction({
    accept: 'form',
    input: z.object({
      plan: id,
      reply: z
        .string()
        .transform(tidy)
        .pipe(z.string().min(1, 'Write your answer first.').max(PLAN_REPLY_MAX, `Keep the answer under ${characters(PLAN_REPLY_MAX)} characters.`)),
    }),
    handler: async (input, context) => {
      const host = admin(context.locals);
      const plan = settle(await context.locals.plans.reply(host.id, input.plan, input.reply), replyRefusals);
      sendLater(context, [planAnsweredLetter(plan, host, absolute(context, `/members/plan/${plan.id}`))]);
      return { member: plan.member.name };
    },
  }),
};
