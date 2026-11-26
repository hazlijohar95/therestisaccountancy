import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { HANDLE, HANDLE_TAKEN, JURISDICTIONS, PROFILE_LIMITS, SECTORS, TOPICS } from '../data/social.ts';
import type { LinkRefusal } from '../server/club.ts';
import { passwordLetter } from '../server/letters.ts';
import type { JoinRefusal } from '../server/social-invites.ts';
import { handleProblem, normaliseHandle, type ClaimRefusal, type FollowRefusal, type SignUpRefusal } from '../server/social-profiles.ts';
import { blankable, email, memberName, oneLine, sendLater, settle, shareable, signedIn, throttle, type Refusal } from './guards.ts';
import { claimRefusals as nominationRefusals } from './nominations.ts';

const handleRefusals = {
  'handle-invalid': { code: 'BAD_REQUEST', message: `Use ${HANDLE.min} to ${HANDLE.max} lowercase letters, digits or underscores.` },
  'handle-reserved': { code: 'BAD_REQUEST', message: 'That handle is kept for the team. Pick another.' },
  'handle-taken': { code: 'CONFLICT', message: HANDLE_TAKEN },
} as const satisfies Record<'handle-invalid' | 'handle-reserved' | 'handle-taken', Refusal>;

const signUpRefusals: Record<SignUpRefusal, Refusal> = {
  ...handleRefusals,
  'email-taken': { code: 'UNAUTHORIZED', message: 'That email already has an account.' },
};

const joinRefusals: Record<JoinRefusal, Refusal> = {
  ...signUpRefusals,
  dead: { code: 'NOT_FOUND', message: 'This invite has been used, has run out, or was withdrawn.' },
};

const claimRefusals: Record<ClaimRefusal, Refusal> = {
  ...handleRefusals,
  'already-claimed': { code: 'CONFLICT', message: 'You already have a handle.' },
  'not-invited': { code: 'FORBIDDEN', message: 'Social is invite-only. Use an invite link, or ask to join.' },
};

const linkRefusals: Record<LinkRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'Your account was not saved. Try again.' },
  suspended: { code: 'FORBIDDEN', message: 'That account is paused. Write to the team to ask about it.' },
};

const followRefusals: Record<FollowRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'There is nobody here by that handle.' },
  self: { code: 'BAD_REQUEST', message: 'You cannot follow yourself.' },
};

/** A handle as typed, checked for shape here so the form can say what is wrong beside the field. Whether it is free is the server's call. */
const handle = z
  .string()
  .transform(normaliseHandle)
  .superRefine((value, ctx) => {
    const problem = handleProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: handleRefusals[problem].message });
  });

const line = (max: number, label: string) => z.string().transform(oneLine).pipe(z.string().max(max, `Keep the ${label} under ${max} characters.`));

export const social = {
  /**
   * Joining from a link: an invite, or a nomination the nominee claims. The link is spent with the new account, in
   * one step, so it lets in one person. Then the welcome link to set a password. Social is invite-only: nothing else
   * makes an account here.
   */
  socialSignUp: defineAction({
    accept: 'form',
    input: z.object({
      name: memberName,
      email,
      handle,
      /** A field people never see. Bots that fill every field get the same answer and nothing is saved. */
      trap: z.string().optional(),
      /** The invite link's token. What it lets in is read again here, never taken from the form. */
      invite: z.string().optional(),
      /** A nomination's link token. Its account goes to Get ticked for proof. */
      nomination: z.string().optional(),
    }),
    handler: async ({ trap, invite, nomination, ...input }, context) => {
      await throttle(context, 'social-sign-up');
      if (!invite && !nomination) throw new ActionError({ code: 'FORBIDDEN', message: 'Social is invite-only. Use an invite link, or ask to join.' });
      if (trap) return { email: input.email, claimed: false };
      const { socialInvites, socialNominations, club } = context.locals;
      const { memberId } = invite
        ? settle(await socialInvites.join(invite, input), joinRefusals)
        : settle(await socialNominations.join(nomination ?? '', input), { ...signUpRefusals, ...nominationRefusals });
      const link = settle(await club.newLink(memberId), linkRefusals);
      sendLater(context, [passwordLetter(shareable(link, context))]);
      return { email: input.email, claimed: !invite };
    },
  }),

  /** Saves the signed-in member's profile, claiming the handle first when they have none. */
  saveProfile: defineAction({
    accept: 'form',
    input: z.object({
      handle: handle.optional(),
      headline: blankable(line(PROFILE_LIMITS.headline, 'headline')),
      sector: blankable(z.union([z.literal(''), z.enum(SECTORS)]).transform((value) => (value === '' ? null : value))),
      city: blankable(line(PROFILE_LIMITS.city, 'city')),
      jurisdictions: z.array(z.enum(JURISDICTIONS)),
      topics: z.array(z.enum(TOPICS)),
      creator: z.boolean(),
      listed: z.boolean(),
    }),
    handler: async ({ handle: claimed, ...fields }, context) => {
      const member = signedIn(context.locals);
      const { socialProfiles } = context.locals;
      if (!(await socialProfiles.ownProfile(member.id))) {
        if (!claimed) throw new ActionError({ code: 'BAD_REQUEST', message: 'Pick a handle first.' });
        settle(await socialProfiles.claimHandle(member.id, claimed), claimRefusals);
      }
      const profile = await socialProfiles.update(member.id, fields);
      if (!profile) throw new ActionError({ code: 'NOT_FOUND', message: 'Your profile was not saved. Try again.' });
      return { handle: profile.handle };
    },
  }),

  follow: defineAction({
    accept: 'form',
    input: z.object({ handle: z.string().min(1) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      settle(await context.locals.socialProfiles.follow(member.id, input.handle), followRefusals);
      return { following: true };
    },
  }),

  unfollow: defineAction({
    accept: 'form',
    input: z.object({ handle: z.string().min(1) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await context.locals.socialProfiles.unfollow(member.id, input.handle);
      return { following: false };
    },
  }),
};
