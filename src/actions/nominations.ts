import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { accountHandle, CLAIM_LIMITS, PLATFORM_PROFILES, PLATFORMS, TOPICS } from '../data/social.ts';
import { socialUrl } from '../server/paths.ts';
import type { AccountRefusal } from '../server/social-claims.ts';
import type { InviteRefusal, NominateRefusal } from '../server/social-nominations.ts';
import { admin, id, settle, signedIn, throttle, type Refusal } from './guards.ts';

const nominateRefusals: Record<NominateRefusal, Refusal> = {
  'handle-invalid': { code: 'BAD_REQUEST', message: 'That does not look like a handle on that platform. Type the handle, or paste the profile’s address.' },
  'on-list': { code: 'CONFLICT', message: 'Already on The List.' },
  closed: { code: 'CONFLICT', message: 'We are not sending that handle an invite.' },
};

const inviteRefusals: Record<InviteRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That nomination is no longer in the queue.' },
  already: { code: 'CONFLICT', message: 'Someone on the team already invited them. Make a new link from the invited list if the first one is lost.' },
};

/** Claiming adds the account for proof, so the account step's refusals can come back here, said for a claim. */
const claimRefusals: Record<AccountRefusal | 'not-found', Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'This invite has been used or withdrawn.' },
  'handle-invalid': { code: 'BAD_REQUEST', message: 'That handle cannot be proven on that platform. Write to the team.' },
  'platform-taken': { code: 'CONFLICT', message: 'You already have an account on that platform here. Remove it on Get ticked, then claim again.' },
  'proven-elsewhere': { code: 'CONFLICT', message: 'Someone has already proven that account. If it is yours, write to the team.' },
};

const site = (context: ActionAPIContext) => (context.site ?? context.url).href;
const inviteLink = (context: ActionAPIContext, token: string) => socialUrl(site(context), `/claim/${encodeURIComponent(token)}`);

export const nominations = {
  nominate: defineAction({
    accept: 'form',
    input: z.object({
      platform: z.enum(PLATFORMS, 'Pick the platform.'),
      handle: z.string('Enter their handle.').transform(accountHandle).pipe(z.string().min(1, 'Enter their handle.').max(100, 'That handle is too long.')),
      topics: z.array(z.enum(TOPICS)).default([]),
      whyUrl: z
        .string()
        .trim()
        .max(CLAIM_LIMITS.url, `Keep the address under ${CLAIM_LIMITS.url} characters.`)
        .pipe(z.union([z.literal(''), z.url({ protocol: /^https$/, hostname: /^([a-z\d-]+\.)+[a-z]{2,}$/i, message: 'Paste the https address of the post.' })]))
        .transform((value) => value || null)
        .optional(),
    })
      /* Checked here as well as by the server, so a bad handle shows beside the field along with any other mistake. */
      .superRefine((value, ctx) => {
        if (!PLATFORM_PROFILES[value.platform].pattern.test(value.handle)) ctx.addIssue({ code: 'custom', path: ['handle'], message: nominateRefusals['handle-invalid'].message });
      }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'nominate');
      const { outcome } = settle(await context.locals.socialNominations.nominate(member.id, { ...input, whyUrl: input.whyUrl ?? null }), nominateRefusals);
      return { outcome, handle: input.handle };
    },
  }),

  inviteNomination: defineAction({
    accept: 'form',
    input: z.object({ nomination: id }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      const { nomination, token } = settle(await context.locals.socialNominations.invite(input.nomination, reviewer.id), inviteRefusals);
      return { platform: nomination.platform, handle: nomination.handle, url: nomination.url, link: inviteLink(context, token) };
    },
  }),

  relinkNomination: defineAction({
    accept: 'form',
    input: z.object({ nomination: id }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      const { nomination, token } = settle(await context.locals.socialNominations.relink(input.nomination, reviewer.id), inviteRefusals);
      return { platform: nomination.platform, handle: nomination.handle, url: nomination.url, link: inviteLink(context, token) };
    },
  }),

  rejectNomination: defineAction({
    accept: 'form',
    input: z.object({ nomination: id }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      settle(await context.locals.socialNominations.reject(input.nomination, reviewer.id), inviteRefusals);
      return { decided: 'nomination-rejected' as const };
    },
  }),

  /** A signed-in member claims an invite: the account goes to Get ticked for proof, then the invite is spent. */
  claimNomination: defineAction({
    accept: 'form',
    input: z.object({ token: z.string().min(1) }),
    handler: async (input, context) => {
      signedIn(context.locals);
      const profile = context.locals.profile;
      if (!profile) throw new ActionError({ code: 'BAD_REQUEST', message: 'Claim your handle first.' });
      const { socialNominations, socialClaims } = context.locals;
      const invitation = await socialNominations.invitation(input.token);
      if (!invitation) throw new ActionError(claimRefusals['not-found']);
      settle(await socialClaims.addAccount(profile.memberId, invitation.platform, invitation.handle), claimRefusals);
      settle(await socialNominations.claim(input.token), claimRefusals);
      return { platform: invitation.platform };
    },
  }),

  declineNomination: defineAction({
    accept: 'form',
    input: z.object({ token: z.string().min(1) }),
    handler: async (input, context) => {
      await throttle(context, 'decline');
      if (!(await context.locals.socialNominations.decline(input.token))) throw new ActionError(claimRefusals['not-found']);
      return { declined: true };
    },
  }),
};
