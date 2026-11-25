import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ROLES, type EditRefusal, type InviteRefusal, type LinkRefusal } from '../server/club.ts';
import { getClub } from '../server/instance.ts';
import { admin, email, id, memberName, settle, shareable, type Refusal } from './guards.ts';

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

export const adminActions = {
  invite: defineAction({
    accept: 'form',
    input: z.object({ request: id }),
    handler: (input, context) => {
      admin(context.locals);
      return shareable(settle(getClub().inviteFromRequest(input.request), inviteRefusals), context);
    },
  }),

  newLink: defineAction({
    accept: 'form',
    input: z.object({ member: id }),
    handler: (input, context) => {
      admin(context.locals);
      return shareable(settle(getClub().newLink(input.member), linkRefusals), context);
    },
  }),

  decline: defineAction({
    accept: 'form',
    input: z.object({ request: id }),
    handler: (input, context) => {
      admin(context.locals);
      if (!getClub().declineRequest(input.request)) throw new ActionError(inviteRefusals.decided);
      return { declined: true };
    },
  }),

  updateMember: defineAction({
    accept: 'form',
    input: z.object({ member: id, name: memberName, email, role: z.enum(ROLES).optional() }),
    handler: (input, context) => {
      const actor = admin(context.locals);
      settle(getClub().updateMember(actor.id, input.member, input), memberRefusals);
      return { saved: true };
    },
  }),

  suspendMember: defineAction({
    accept: 'form',
    input: z.object({ member: id }),
    handler: (input, context) => {
      const actor = admin(context.locals);
      settle(getClub().suspendMember(actor.id, input.member), memberRefusals);
      return { status: 'suspended' as const };
    },
  }),

  reinstateMember: defineAction({
    accept: 'form',
    input: z.object({ member: id }),
    handler: (input, context) => {
      admin(context.locals);
      settle(getClub().reinstateMember(input.member), memberRefusals);
      return { status: 'reinstated' as const };
    },
  }),

  removeMember: defineAction({
    accept: 'form',
    input: z.object({ member: id, confirm: z.literal('yes', { error: 'Tick the box to confirm.' }) }),
    handler: (input, context) => {
      const actor = admin(context.locals);
      settle(getClub().removeMember(actor.id, input.member), memberRefusals);
      return { removed: true };
    },
  }),
};
