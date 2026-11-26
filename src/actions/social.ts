import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { HANDLE, JURISDICTIONS, PROFILE_LIMITS, SECTORS, TOPICS } from '../data/social.ts';
import type { LinkRefusal } from '../server/club.ts';
import { passwordLetter } from '../server/letters.ts';
import { handleProblem, normaliseHandle, type ClaimRefusal, type FollowRefusal, type SignUpRefusal } from '../server/social-profiles.ts';
import { email, memberName, oneLine, sendLater, settle, shareable, signedIn, throttle, type Refusal } from './guards.ts';

const handleRefusals = {
  'handle-invalid': { code: 'BAD_REQUEST', message: `Use ${HANDLE.min} to ${HANDLE.max} lowercase letters, digits or underscores.` },
  'handle-reserved': { code: 'BAD_REQUEST', message: 'That handle is kept for the team. Pick another.' },
  'handle-taken': { code: 'CONFLICT', message: 'Someone already has that handle. Pick another.' },
} as const satisfies Record<'handle-invalid' | 'handle-reserved' | 'handle-taken', Refusal>;

const signUpRefusals: Record<SignUpRefusal, Refusal> = {
  ...handleRefusals,
  'email-taken': { code: 'UNAUTHORIZED', message: 'That email already has an account.' },
};

const claimRefusals: Record<ClaimRefusal, Refusal> = {
  ...handleRefusals,
  'already-claimed': { code: 'CONFLICT', message: 'You already have a handle.' },
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
  /** Free sign-up: an invited member with a handle, sent the welcome link to set a password. */
  socialSignUp: defineAction({
    accept: 'form',
    input: z.object({
      name: memberName,
      email,
      handle,
      /** A field people never see. Bots that fill every field get the same answer and nothing is saved. */
      trap: z.string().optional(),
      /** The invite link's token, when they came from one. Its account is read again here, never taken from the form. */
      invite: z.string().optional(),
    }),
    handler: async ({ trap, invite, ...input }, context) => {
      await throttle(context, 'social-sign-up');
      if (trap) return { email: input.email, claimed: false };
      const { socialProfiles, socialNominations, socialClaims, club } = context.locals;
      const invitation = invite ? await socialNominations.invitation(invite) : null;
      const { memberId } = settle(await socialProfiles.signUp(input), signUpRefusals);
      /* The invite is spent only once its account waits for proof. If that is refused, the invite stays open to claim signed in. */
      const claimed = invite !== undefined && invitation !== null && (await socialClaims.addAccount(memberId, invitation.platform, invitation.handle)).ok;
      if (claimed) await socialNominations.claim(invite);
      const link = settle(await club.newLink(memberId), linkRefusals);
      sendLater(context, [passwordLetter(shareable(link, context))]);
      return { email: input.email, claimed };
    },
  }),

  /** Saves the signed-in member's profile, claiming the handle first when they have none. */
  saveProfile: defineAction({
    accept: 'form',
    input: z.object({
      handle: handle.optional(),
      headline: line(PROFILE_LIMITS.headline, 'headline'),
      sector: z.union([z.literal(''), z.enum(SECTORS)]).transform((value) => (value === '' ? null : value)),
      city: line(PROFILE_LIMITS.city, 'city'),
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
