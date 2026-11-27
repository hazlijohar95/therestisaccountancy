import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { REQUEST_LIMITS } from '../../../src/data/social.ts';
import { passwordLetterFor } from '../../../src/server/letters.ts';
import { inviteUrl } from '../../../src/server/paths.ts';
import type { JoinRefusal, MemberInviteRefusal, RedeemRefusal, RevokeRefusal } from '../../../src/server/social-invites.ts';
import type { SignUpRefusal } from '../../../src/server/social-profiles.ts';
import type { RequestRefusal } from '../../../src/server/social-requests.ts';
import { email, memberName, numberId, oneLine, token } from '../lib/fields.ts';
import { action } from '../lib/action.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';
import { claimRefusals as nominationRefusals } from './social-nominations.ts';
import { handleField, handleRefusals } from './social-profiles.ts';

/*
 * Social is invite-only. Anyone may ask to join; members with a ticked credential hand on links of their own, shown
 * once since only their hash is kept. Invite and nomination links land on the sign-up page.
 */

const requestRefusals: Record<RequestRefusal, string> = {
  pending: 'You have already asked with this email. We will email you once someone on the team has read it.',
};
const memberInviteRefusals: Record<MemberInviteRefusal, string> = {
  'no-tick': 'Invites open once one of your credentials is ticked.',
  'none-left': 'You have no invites left. Revoke one nobody has used to make another.',
};
const revokeRefusals: Record<RevokeRefusal, string> = {
  'not-found': 'That invite is not yours to revoke.',
  used: 'Someone has used that invite, so it cannot be taken back.',
};
const redeemRefusals: Record<RedeemRefusal, string> = {
  dead: 'This invite has been used, has run out, or was withdrawn.',
  'already-in': 'You are in already. Pick your handle.',
};
const signUpRefusals: Record<SignUpRefusal, string> = { ...handleRefusals, 'email-taken': 'That email already has an account.' };
const joinRefusals: Record<JoinRefusal, string> = { ...signUpRefusals, dead: 'This invite has been used, has run out, or was withdrawn.' };
const requestSchema = z.object({
  name: memberName,
  email,
  about: z
    .string()
    .transform(oneLine)
    .pipe(z.string().min(1, 'Say who you are and where you post.').max(REQUEST_LIMITS.about, `Keep it under ${REQUEST_LIMITS.about} characters.`)),
  link: z
    .string()
    .trim()
    .max(REQUEST_LIMITS.link, `Keep the address under ${REQUEST_LIMITS.link} characters.`)
    .pipe(z.union([z.literal(''), z.url({ protocol: /^https$/, hostname: /^([a-z\d-]+\.)+[a-z]{2,}$/i, message: 'Paste the https address of your profile.' })]))
    .transform((value) => value || null),
  /** A field people never see. Bots that fill every field get the same answer and nothing is saved. */
  trap: z.string().optional(),
});

const signUpSchema = z.object({
  name: memberName,
  email,
  handle: handleField,
  trap: z.string().optional(),
  invite: z.string().optional(),
  nomination: z.string().optional(),
});

/** The request page: a member with a profile is in already. */
export const requestPage = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) return { handle: null };
  const own = await withStore(async (store) => await store.socialProfiles.ownProfile(member.id));
  return { handle: own?.handle ?? null };
});

/**
 * Anyone asks to join. The answer is the same whether or not the email has an account. Asking twice is not a mistake,
 * so it answers waiting rather than a refusal.
 */
export const requestToJoin = createServerFn({ method: 'POST' })
  .validator((input: { name: string; email: string; about: string; link: string; trap: string }) => input)
  .handler(
    action({ access: 'anyone', input: requestSchema, limit: 'social-request' }, async ({ input, store }) => {
      const { trap, ...draft } = input;
      if (trap) return done({ email: draft.email, waiting: null });
      const result = await store.socialRequests.request(draft);
      return done({ email: draft.email, waiting: result.ok ? null : requestRefusals[result.reason] });
    }),
  );

/** A member's invite links and how many they may still make. */
export const invitesPage = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) return null;
  return withStore(async (store) => {
    const own = await store.socialProfiles.ownProfile(member.id);
    if (!own) return { hasProfile: false as const };
    const allowance = await store.socialInvites.allowance(member.id);
    const mine = await store.socialInvites.mine(member.id);
    return { hasProfile: true as const, allowance: { eligible: allowance.eligible, left: allowance.left }, mine };
  });
});

/** A member makes an invite link to hand on. Shown once. */
export const createInvite = createServerFn({ method: 'POST' }).handler(
  action({ access: 'member', input: z.undefined(), refusals: memberInviteRefusals }, async ({ actor, store }) => {
    const result = await store.socialInvites.create(actor.id);
    return result.ok ? done({ link: inviteUrl(env.SITE_URL, result.value.token) }) : result;
  }),
);

export const revokeInvite = createServerFn({ method: 'POST' })
  .validator((input: { invite: number }) => input)
  .handler(
    action({ access: 'member', input: z.object({ invite: numberId }), refusals: revokeRefusals }, async ({ actor, input, store }) => {
      const result = await store.socialInvites.revoke(actor.id, input.invite);
      return result.ok ? done(null) : result;
    }),
  );

/** A signed-in member without a handle uses a link to get in. They pick the handle next. */
export const useInvite = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(
    action({ access: 'member', input: z.object({ token: token }), refusals: redeemRefusals }, async ({ actor, input, store }) => {
      if (!input.token) return refused(redeemRefusals.dead);
      const result = await store.socialInvites.redeem(actor.id, input.token);
      return result.ok ? done(null) : result;
    }),
  );

/**
 * Where an invite (?invite=) or a nomination the nominee claims (?nomination=) lands. What the link lets in is read
 * here and again when they join; the form carries only the token.
 */
export const signUpPage = createServerFn({ method: 'GET' })
  .validator((input: { invite: string; nomination: string }) => input)
  .handler(async ({ data }) => {
    const member = await currentMember();
    return withStore(async (store) => {
      const profile = member ? await store.socialProfiles.ownProfile(member.id) : null;
      /* Someone the club accepted, or already let in, picks a handle without spending anyone's invite. */
      const inAlready = member !== null && profile === null && (await store.socialProfiles.mayClaim(member.id));
      const look = data.invite ? await store.socialInvites.look(data.invite) : null;
      const invitation = data.nomination ? await store.socialNominations.invitation(data.nomination) : null;
      return {
        member: member && { name: member.name },
        handle: profile?.handle ?? null,
        inAlready,
        look: look && (look.state === 'live' ? { state: 'live' as const, team: look.kind === 'team', email: look.email, name: look.name, inviter: look.inviter.name } : { state: look.state }),
        invitation: invitation && { platform: invitation.platform, handle: invitation.handle },
      };
    });
  });

/**
 * Joining from a link: an invite, or a nomination the nominee claims. The link is spent with the new account, in one
 * step, so it lets in one person. Then the welcome link to set a password. A refusal about the email or the handle
 * shows beside that field.
 */
export const socialSignUp = createServerFn({ method: 'POST' })
  .validator((input: { name: string; email: string; handle: string; trap: string; invite: string; nomination: string }) => input)
  .handler(
    action({ access: 'anyone', input: signUpSchema, limit: 'social-sign-up' }, async ({ input, store, send }) => {
      const { trap, invite, nomination, ...person } = input;
      if (!invite && !nomination) return refused('Social is invite-only. Use an invite link, or ask to join.');
      if (trap) return done({ email: person.email, claimed: false });
      const joined = invite ? await store.socialInvites.join(invite, person) : await store.socialNominations.join(nomination ?? '', person);
      if (!joined.ok) {
        const reason = joined.reason;
        const message = reason === 'dead' ? joinRefusals.dead : reason === 'not-found' || reason === 'platform-taken' || reason === 'proven-elsewhere' || (reason === 'handle-invalid' && !invite) ? nominationRefusals[reason] : signUpRefusals[reason];
        if (reason === 'email-taken') return refused(message, { email: message });
        if (reason === 'handle-taken') return refused(message, { handle: message });
        return refused(message);
      }
      send([passwordLetterFor(joined.value.link, env.SITE_URL)]);
      return done({ email: person.email, claimed: !invite });
    }),
  );
