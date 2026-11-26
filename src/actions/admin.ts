import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { ROLES, type EditRefusal, type InviteRefusal, type LinkRefusal } from '../server/club.ts';
import { everyRate } from '../data/membership.ts';
import { callLetters } from '../server/calls.ts';
import { deleteMemberEvidence } from '../server/evidence.ts';
import { clubApprovedLetter } from '../server/letters.ts';
import { report } from '../server/report.ts';
import { send } from '../server/mail.ts';
import { absolute, admin, deliver, email, id, memberName, sendLater, settle, type Refusal } from './guards.ts';

/** What the admin sees after accepting a request: the link that was sent, or that an existing account was approved. */
type Invited =
  | { readonly kind: 'link'; readonly issued: Awaited<ReturnType<typeof deliver>> }
  | { readonly kind: 'approved'; readonly name: string; readonly email: string; readonly emailed: boolean };

const memberRefusals: Record<EditRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'There is no such member.' },
  self: { code: 'FORBIDDEN', message: 'You cannot do that to your own account. Ask another admin.' },
  'last-admin': { code: 'CONFLICT', message: 'The club needs at least one active admin. Make someone else an admin first.' },
  'email-taken': { code: 'CONFLICT', message: 'Another member already uses that email.' },
};

const inviteRefusals: Record<InviteRefusal, Refusal> = {
  decided: { code: 'CONFLICT', message: 'That request has already been decided.' },
  suspended: { code: 'CONFLICT', message: 'That email belongs to a suspended member. Reinstate them first, or decline the request.' },
};

const linkRefusals: Record<LinkRefusal, Refusal> = {
  'not-found': memberRefusals['not-found'],
  suspended: { code: 'CONFLICT', message: 'A suspended member cannot get a link. Reinstate them first.' },
};

/**
 * Calls booked with a host, gathered before a change that stops them hosting: removal, suspension or losing the admin
 * role. Their slots then read as cancelled, and these members are told as if the host had cancelled.
 */
const bookedWith = async (context: ActionAPIContext, memberId: number) => {
  const host = await context.locals.club.member(memberId);
  if (!host || host.role !== 'admin') return [];
  return (await context.locals.calls.upcoming()).flatMap((slot) => (slot.state === 'booked' && slot.host.email === host.email ? [slot] : []));
};

const tellCalledOff = (context: ActionAPIContext, calls: Awaited<ReturnType<typeof bookedWith>>) =>
  sendLater(context, calls.flatMap((call) => callLetters('cancelled-by-host', call, absolute(context, '/'))));

export const adminActions = {
  invite: defineAction({
    accept: 'form',
    input: z.object({ request: id }),
    handler: async (input, context) => {
      admin(context.locals);
      const invitation = settle(await context.locals.club.inviteFromRequest(input.request), inviteRefusals);
      if (invitation.kind === 'link') return { kind: 'link', issued: await deliver(invitation.link, context) } satisfies Invited;
      const { name, email: address } = invitation.member;
      const emailed = await send(clubApprovedLetter({ name, email: address, rate: everyRate, payUrl: absolute(context, '/members/pay') }));
      return { kind: 'approved', name, email: address, emailed } satisfies Invited;
    },
  }),

  newLink: defineAction({
    accept: 'form',
    input: z.object({ member: id }),
    handler: async (input, context) => {
      admin(context.locals);
      return deliver(settle(await context.locals.club.newLink(input.member), linkRefusals), context);
    },
  }),

  decline: defineAction({
    accept: 'form',
    input: z.object({ request: id }),
    handler: async (input, context) => {
      admin(context.locals);
      if (!await context.locals.club.declineRequest(input.request)) throw new ActionError(inviteRefusals.decided);
      return { declined: true };
    },
  }),

  updateMember: defineAction({
    accept: 'form',
    input: z.object({ member: id, name: memberName, email, role: z.enum(ROLES).optional() }),
    handler: async (input, context) => {
      const actor = admin(context.locals);
      const booked = await bookedWith(context, input.member);
      const updated = settle(await context.locals.club.updateMember(actor.id, input.member, input), memberRefusals);
      if (updated.role !== 'admin') tellCalledOff(context, booked);
      return { saved: true };
    },
  }),

  suspendMember: defineAction({
    accept: 'form',
    input: z.object({ member: id }),
    handler: async (input, context) => {
      const actor = admin(context.locals);
      const booked = await bookedWith(context, input.member);
      settle(await context.locals.club.suspendMember(actor.id, input.member), memberRefusals);
      tellCalledOff(context, booked);
      return { status: 'suspended' as const };
    },
  }),

  reinstateMember: defineAction({
    accept: 'form',
    input: z.object({ member: id }),
    handler: async (input, context) => {
      admin(context.locals);
      settle(await context.locals.club.reinstateMember(input.member), memberRefusals);
      return { status: 'reinstated' as const };
    },
  }),

  removeMember: defineAction({
    accept: 'form',
    input: z.object({ member: id, confirm: z.literal('yes', { error: 'Tick the box to confirm.' }) }),
    handler: async (input, context) => {
      const actor = admin(context.locals);
      const booked = await bookedWith(context, input.member);
      settle(await context.locals.club.removeMember(actor.id, input.member), memberRefusals);
      /* Their claims go with them, so documents still waiting for the team would be left in R2 with nothing pointing at them. */
      await deleteMemberEvidence(input.member).catch((error: unknown) => report('evidence', `Documents of removed member ${input.member} were not deleted`, error));
      tellCalledOff(context, booked);
      return { removed: true };
    },
  }),
};
