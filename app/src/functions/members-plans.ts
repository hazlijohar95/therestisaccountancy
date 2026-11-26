import { notFound, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { PLAN_ANSWER_MAX, planSections, type PlanSectionSlug } from '../../../src/data/plan.ts';
import { tidy } from '../../../src/server/community.ts';
import { missingSections, planSentLetter, type AnsweredPlan, type OpenPlan, type PlanAnswers, type PlanReply } from '../../../src/server/plans.ts';
import { paidOrRefusal } from '../lib/guards.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { paidMemberOrRedirect } from '../lib/members.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

/** A plan as the member's pages show it: the answers and where it stands. */
export type PlanView =
  | { readonly id: number; readonly status: 'draft'; readonly answers: PlanAnswers; readonly updatedAt: string; readonly missing: readonly PlanSectionSlug[] }
  | { readonly id: number; readonly status: 'sent'; readonly answers: PlanAnswers; readonly updatedAt: string; readonly sentAt: string };
export interface AnsweredView {
  readonly id: number;
  readonly status: 'answered';
  readonly answers: PlanAnswers;
  readonly sentAt: string;
  readonly reply: PlanReply;
}

const openView = (plan: OpenPlan): PlanView =>
  plan.status === 'draft'
    ? { id: plan.id, status: 'draft', answers: { ...plan.answers }, updatedAt: plan.updatedAt, missing: missingSections(plan.answers) }
    : { id: plan.id, status: 'sent', answers: { ...plan.answers }, updatedAt: plan.updatedAt, sentAt: plan.sentAt };
const answeredView = (plan: AnsweredPlan): AnsweredView => ({
  id: plan.id,
  status: 'answered',
  answers: { ...plan.answers },
  sentAt: plan.sentAt,
  reply: { text: plan.reply.text, by: plan.reply.by, at: plan.reply.at },
});

const plansOf = (memberId: number) =>
  withStore(async (store) => {
    const { open, answered } = await store.plans.ofMember(memberId);
    return { open: open && openView(open), answered: answered.map(answeredView) };
  });

/** The member's open plan, if any, and every answered one, newest first. */
export const membersPlan = createServerFn({ method: 'GET' }).handler(async () => plansOf((await paidMemberOrRedirect()).id));

/** One answered plan. The open plan has its own page, so its id leads there. */
export const membersAnsweredPlan = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const member = await paidMemberOrRedirect();
    const id = Number(data);
    const { open, answered } = await plansOf(member.id);
    if (open?.id === id) throw redirect({ href: '/members/plan' });
    const plan = answered.find((p) => p.id === id);
    if (!plan) throw notFound();
    return { plan, open: open !== null, isLatest: answered[0]?.id === plan.id };
  });

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

const withTheHosts = 'Your plan is with the hosts, so that was not saved. Take it back first to change it.';

export const savePlan = createServerFn({ method: 'POST' })
  .validator((input: Record<string, string>) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const input = parsed(planFields, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    const saved = await withStore(async (store) => {
      const result = await store.plans.save(member.value.id, input.value);
      return result.ok;
    });
    return saved ? done(null) : refused(withTheHosts);
  });

/** Saves the plan, and sends it when every section is written. A short one stays a draft, so nothing typed is lost. */
export const sendPlan = createServerFn({ method: 'POST' })
  .validator((input: Record<string, string>) => input)
  .handler(async ({ data }): Promise<Outcome<{ sent: boolean }>> => {
    const input = parsed(planFields, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    const result = await withStore(async (store) => {
      const sent = await store.plans.send(member.value.id, input.value);
      if (!sent.ok) return null;
      const { plan, changed } = sent.value;
      const letter = changed && plan.status === 'sent' ? { plan, admins: await store.club.adminEmails() } : null;
      return { sent: plan.status === 'sent', letter };
    });
    if (!result) return refused(withTheHosts);
    if (result.letter?.plan.status === 'sent' && result.letter.admins.length) {
      sendLater([planSentLetter(result.letter.admins, result.letter.plan, absolute(`/admin/plans#plan-${result.letter.plan.id}`))]);
    }
    return done({ sent: result.sent });
  });

export const takeBackPlan = createServerFn({ method: 'POST' }).handler(async (): Promise<Outcome<null>> => {
  const member = await paidOrRefusal();
  if (!member.ok) return member;
  const taken = await withStore(async (store) => (await store.plans.takeBack(member.value.id)).ok);
  return taken ? done(null) : refused('A host has answered your plan already, so it can no longer be taken back.');
});

export const startPlan = createServerFn({ method: 'POST' }).handler(async (): Promise<Outcome<null>> => {
  const member = await paidOrRefusal();
  if (!member.ok) return member;
  await withStore(async (store) => {
    await store.plans.startNext(member.value.id);
  });
  return done(null);
});
