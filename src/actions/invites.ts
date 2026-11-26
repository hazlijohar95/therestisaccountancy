import { defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { REQUEST_LIMITS } from '../data/social.ts';
import type { LinkRefusal } from '../server/club.ts';
import { send } from '../server/mail.ts';
import { socialUrl } from '../server/paths.ts';
import type { MemberInviteRefusal, RedeemRefusal, RevokeRefusal, TeamInviteRefusal } from '../server/social-invites.ts';
import { requestApprovedLetter, requestDeclinedLetter, teamInviteLetter } from '../server/social-letters.ts';
import type { DecideRefusal, RequestRefusal } from '../server/social-requests.ts';
import { admin, blankable, email, id, memberName, oneLine, sendLater, settle, shareable, signedIn, throttle, type Refusal } from './guards.ts';

/*
 * Social is invite-only. Anyone may ask to join; the team approves or declines. The team invites by email, and members
 * with a ticked credential hand on links of their own. Invite links are shown once: only their hash is kept.
 */

const requestRefusals: Record<RequestRefusal, Refusal> = {
  pending: { code: 'CONFLICT', message: 'You have already asked with this email. We will email you once someone on the team has read it.' },
};

const decideRefusals: Record<DecideRefusal, Refusal> = {
  decided: { code: 'CONFLICT', message: 'Someone on the team already decided that request.' },
  suspended: { code: 'FORBIDDEN', message: 'That email belongs to a paused account. Reinstate it in the club admin first.' },
};

const teamInviteRefusals: Record<TeamInviteRefusal, Refusal> = {
  'on-social': { code: 'CONFLICT', message: 'That email is on Social already.' },
};

const memberInviteRefusals: Record<MemberInviteRefusal, Refusal> = {
  'no-tick': { code: 'FORBIDDEN', message: 'Invites open once one of your credentials is ticked.' },
  'none-left': { code: 'CONFLICT', message: 'You have no invites left. Revoke one nobody has used to make another.' },
};

const revokeRefusals: Record<RevokeRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That invite is not yours to revoke.' },
  used: { code: 'CONFLICT', message: 'Someone has used that invite, so it cannot be taken back.' },
};

const redeemRefusals: Record<RedeemRefusal, Refusal> = {
  dead: { code: 'NOT_FOUND', message: 'This invite has been used, has run out, or was withdrawn.' },
  'already-in': { code: 'CONFLICT', message: 'You are in already. Pick your handle.' },
};

const linkRefusals: Record<LinkRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That account was not saved. Try again.' },
  suspended: { code: 'FORBIDDEN', message: 'That account is paused.' },
};

const site = (context: ActionAPIContext) => (context.site ?? context.url).href;
/** Where an invite link lands: the short sign-up, which also tells a dead link apart. */
const inviteLink = (context: ActionAPIContext, token: string) => socialUrl(site(context), `/sign-up?invite=${encodeURIComponent(token)}`);

export const invites = {
  /** Anyone asks to join. The answer is the same whether or not the email has an account. */
  requestToJoin: defineAction({
    accept: 'form',
    input: z.object({
      name: memberName,
      email,
      about: z
        .string()
        .transform(oneLine)
        .pipe(z.string().min(1, 'Say who you are and where you post.').max(REQUEST_LIMITS.about, `Keep it under ${REQUEST_LIMITS.about} characters.`)),
      link: blankable(
        z
          .string()
          .trim()
          .max(REQUEST_LIMITS.link, `Keep the address under ${REQUEST_LIMITS.link} characters.`)
          .pipe(z.union([z.literal(''), z.url({ protocol: /^https$/, hostname: /^([a-z\d-]+\.)+[a-z]{2,}$/i, message: 'Paste the https address of your profile.' })])),
      ).transform((value) => value || null),
      /** A field people never see. Bots that fill every field get the same answer and nothing is saved. */
      trap: z.string().optional(),
    }),
    handler: async ({ trap, ...draft }, context) => {
      await throttle(context, 'social-request');
      if (!trap) settle(await context.locals.socialRequests.request(draft), requestRefusals);
      return { email: draft.email };
    },
  }),

  approveRequest: defineAction({
    accept: 'form',
    input: z.object({ request: id }),
    handler: async (input, context) => {
      const team = admin(context.locals);
      const { socialRequests, club } = context.locals;
      const approval = settle(await socialRequests.approve(input.request, team.id), decideRefusals);
      if (approval.kind === 'welcome') {
        const link = shareable(settle(await club.newLink(approval.memberId), linkRefusals), context);
        sendLater(context, [requestApprovedLetter(link, { link: link.link, expiresAt: link.expiresAt })]);
      } else {
        const signIn = new URL(`/sign-in?next=${encodeURIComponent(socialUrl(site(context), '/me'))}`, site(context)).href;
        sendLater(context, [requestApprovedLetter(approval, { signIn, hasProfile: approval.hasProfile })]);
      }
      return { decided: 'request-approved' as const };
    },
  }),

  declineRequest: defineAction({
    accept: 'form',
    input: z.object({ request: id }),
    handler: async (input, context) => {
      const team = admin(context.locals);
      const declined = settle(await context.locals.socialRequests.decline(input.request, team.id), { decided: decideRefusals.decided });
      sendLater(context, [requestDeclinedLetter(declined)]);
      return { decided: 'request-declined' as const };
    },
  }),

  /** The team invites by email. The link is emailed and shown once here, to send by hand if the email fails. */
  teamInvite: defineAction({
    accept: 'form',
    input: z.object({ email, name: blankable(z.string().transform(oneLine).pipe(z.string().max(60, 'Keep the name under 60 characters.'))) }),
    handler: async (input, context) => {
      const team = admin(context.locals);
      const to = { email: input.email, name: input.name || null };
      const { token, invite } = settle(await context.locals.socialInvites.inviteByEmail(team.id, to), teamInviteRefusals);
      const link = inviteLink(context, token);
      const emailed = await send(teamInviteLetter(to, team, { link, expiresAt: invite.expiresAt }));
      return { email: to.email, link, emailed };
    },
  }),

  withdrawTeamInvite: defineAction({
    accept: 'form',
    input: z.object({ invite: id }),
    handler: async (input, context) => {
      admin(context.locals);
      settle(await context.locals.socialInvites.withdraw(input.invite), revokeRefusals);
      return { decided: 'invite-withdrawn' as const };
    },
  }),

  /** A member makes an invite link to hand on. Shown once. */
  createInvite: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const member = signedIn(context.locals);
      const { token } = settle(await context.locals.socialInvites.create(member.id), memberInviteRefusals);
      return { link: inviteLink(context, token) };
    },
  }),

  revokeInvite: defineAction({
    accept: 'form',
    input: z.object({ invite: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      settle(await context.locals.socialInvites.revoke(member.id, input.invite), revokeRefusals);
      return { revoked: true };
    },
  }),

  /** A signed-in member without a handle uses a link to get in. They pick the handle next. */
  useInvite: defineAction({
    accept: 'form',
    input: z.object({ token: z.string().min(1) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      settle(await context.locals.socialInvites.redeem(member.id, input.token), redeemRefusals);
      return { redeemed: true };
    },
  }),
};
