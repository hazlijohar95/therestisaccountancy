import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { accountHandle, CLAIM_LIMITS, PLATFORM_PROFILES, PLATFORMS, TOPICS } from '../../../src/data/social.ts';
import type { ClaimRefusal, NominateRefusal } from '../../../src/server/social-nominations.ts';
import { token } from '../lib/fields.ts';
import { memberOrRefusal } from '../lib/guards.server.ts';
import { allowed, tooManyTries } from '../lib/limits.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/* Nominations stay private: only the nominator sees theirs, and only the nominee sees their invite. */

const nominateRefusals: Record<NominateRefusal, string> = {
  'handle-invalid': 'That does not look like a handle on that platform. Type the handle, or paste the profile’s address.',
  'on-list': 'Already on The List.',
  closed: 'We are not sending that handle an invite.',
};

/** Claiming adds the account for proof, so the account step's refusals can come back here, said for a claim. */
export const claimRefusals: Record<ClaimRefusal, string> = {
  'not-found': 'This invite has been used or withdrawn.',
  'handle-invalid': 'That handle cannot be proven on that platform. Write to the team.',
  'platform-taken': 'You already have an account on that platform here. Remove it on Get ticked, then claim again.',
  'proven-elsewhere': 'Someone has already proven that account. If it is yours, write to the team.',
};

const claimInviteRefusals: Record<ClaimRefusal | 'no-handle', string> = { ...claimRefusals, 'no-handle': 'Claim your handle first.' };

const nominateSchema = z
  .object({
    platform: z.enum(PLATFORMS, 'Pick the platform.'),
    handle: z.string('Enter their handle.').transform(accountHandle).pipe(z.string().min(1, 'Enter their handle.').max(100, 'That handle is too long.')),
    topics: z.array(z.enum(TOPICS)),
    whyUrl: z
      .string()
      .trim()
      .max(CLAIM_LIMITS.url, `Keep the address under ${CLAIM_LIMITS.url} characters.`)
      .pipe(z.union([z.literal(''), z.url({ protocol: /^https$/, hostname: /^([a-z\d-]+\.)+[a-z]{2,}$/i, message: 'Paste the https address of the post.' })]))
      .transform((value) => value || null),
  })
  /* Checked here as well as by the server, so a bad handle shows beside the field along with any other mistake. */
  .superRefine((value, ctx) => {
    if (!PLATFORM_PROFILES[value.platform].pattern.test(value.handle)) ctx.addIssue({ code: 'custom', path: ['handle'], message: nominateRefusals['handle-invalid'] });
  });

/**
 * Nominates someone by their handle on a platform. A new nomination and a counted one answer the same, so a member
 * never learns that someone else nominated. Refusals are about the handle and show beside it; already on The List
 * also names the profile that proved the account.
 */
export const nominate = createServerFn({ method: 'POST' })
  .validator((input: { platform: string; handle: string; topics: readonly string[]; whyUrl: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ outcome: 'yes' | 'already' }> | (Outcome<never> & { readonly listed: string | null })> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = parsed(nominateSchema, data);
    if (!input.ok) return input;
    if (!(await allowed('nominate'))) return refused(tooManyTries);
    return withStore(async (store) => {
      const result = await store.socialNominations.nominate(member.value.id, input.value);
      if (result.ok) return done({ outcome: result.value.outcome === 'already' ? ('already' as const) : ('yes' as const) });
      const message = nominateRefusals[result.reason];
      const listed = result.reason === 'on-list' ? await store.socialNominations.onList(input.value.platform, input.value.handle) : null;
      return { ...refused(message, { handle: message }), listed };
    });
  });

/** The nominate page needs only to know who is asking. */
export const nominatePage = createServerFn({ method: 'GET' }).handler(async () => ({ signedIn: (await currentMember()) !== null }));

/** What an invite says to the person it is for, and where the reader stands. Null when it is used or withdrawn. */
export const claimPage = createServerFn({ method: 'GET' })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    const member = await currentMember();
    return withStore(async (store) => {
      const invitation = await store.socialNominations.invitation(token);
      const profile = member ? await store.socialProfiles.ownProfile(member.id) : null;
      return {
        invitation: invitation && { platform: invitation.platform, handle: invitation.handle, nominators: invitation.nominators, topics: invitation.topics },
        signedIn: member !== null,
        hasProfile: profile !== null,
      };
    });
  });

/** A signed-in member claims an invite: the account goes to Get ticked for proof, then the invite is spent. */
export const claimNomination = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = parsed(z.object({ token: token }), data);
    if (!input.ok) return input;
    const result = await withStore(async (store) => await store.socialNominations.claim(member.value.id, input.value.token));
    return result.ok ? done(null) : refused(claimInviteRefusals[result.reason]);
  });

/** The nominee says no. Anyone with the link may, signed in or not, and the handle is never invited again. */
export const declineNomination = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const input = parsed(z.object({ token: token }), data);
    if (!input.ok) return input;
    if (!(await allowed('decline'))) return refused(tooManyTries);
    const declined = await withStore(async (store) => await store.socialNominations.decline(input.value.token));
    return declined ? done(null) : refused(claimRefusals['not-found']);
  });
