import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { HANDLE, HANDLE_TAKEN, handleProblem, JURISDICTIONS, normaliseHandle, PROFILE_LIMITS, SECTORS, TOPICS, TRACKS, type Topic, type Track } from '../../../src/data/social.ts';
import { claimWhen, renewsIn } from '../../../src/lib/ticks.ts';
import type { VouchRefusal } from '../../../src/server/social-claims.ts';
import type { FollowRefusal, HandleRefusal, SaveRefusal } from '../../../src/server/social-profiles.ts';
import { numberId, oneLine, token } from '../lib/fields.ts';
import { action } from '../lib/action.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/* Profiles: The List, a member's page, following, vouching, and editing your own. */

export const handleRefusals: Record<HandleRefusal, string> = {
  'handle-invalid': `Use ${HANDLE.min} to ${HANDLE.max} lowercase letters, digits or underscores.`,
  'handle-reserved': 'That handle is kept for the team. Pick another.',
  'handle-taken': HANDLE_TAKEN,
};

const saveRefusals: Record<SaveRefusal, string> = {
  ...handleRefusals,
  'already-claimed': 'You already have a handle.',
  'not-invited': 'Social is invite-only. Use an invite link, or ask to join.',
  'no-handle': 'Pick a handle first.',
};

const followRefusals: Record<FollowRefusal, string> = {
  'not-found': 'There is nobody here by that handle.',
  self: 'You cannot follow yourself.',
};

const vouchRefusals: Record<VouchRefusal, string> = {
  'not-found': 'That claim is no longer here.',
  self: 'You cannot vouch for yourself.',
  'no-seal': 'Only members with the seal can vouch.',
  already: 'You have already vouched for this.',
};

/** A handle as typed, checked for shape here so the form can say what is wrong beside the field. Whether it is free is the server's call. */
export const handleField = z
  .string()
  .transform(normaliseHandle)
  .superRefine((value, ctx) => {
    const problem = handleProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: handleRefusals[problem] });
  });

const line = (max: number, label: string) => z.string().transform(oneLine).pipe(z.string().max(max, `Keep the ${label} under ${max} characters.`));

const profileSchema = z.object({
  handle: handleField.optional(),
  headline: line(PROFILE_LIMITS.headline, 'headline'),
  sector: z.union([z.literal(''), z.enum(SECTORS)]).transform((value) => (value === '' ? null : value)),
  city: line(PROFILE_LIMITS.city, 'city'),
  jurisdictions: z.array(z.enum(JURISDICTIONS)),
  topics: z.array(z.enum(TOPICS)),
  creator: z.boolean(),
  listed: z.boolean(),
});

/** The List: profiles ranked by peer points, and the reader's own private nominations on the full list. */
export const listPage = createServerFn({ method: 'GET' })
  .validator((input: { topic: Topic | null; track: Track | null }) => input)
  .handler(async ({ data }) => {
    const member = await currentMember();
    const topic = TOPICS.find((t) => t === data.topic);
    const track = TRACKS.find((t) => t === data.track);
    const filtered = topic !== undefined || track !== undefined;
    return withStore(async (store) => {
      const entries = await store.socialProfiles.list({ topic, track });
      /* Filters narrow The List, so a member's own nominations, which nobody else sees, show only on the full one. */
      const nominated = member && !filtered ? await store.socialNominations.mine(member.id) : [];
      return { entries, nominated, filtered };
    });
  });

/** Where /me goes: the member's own profile, or the handle form when they have none. Null when signed out. */
export const ownPath = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) return null;
  const own = await withStore(async (store) => await store.socialProfiles.ownProfile(member.id));
  return own ? { handle: own.handle } : { handle: null };
});

/** A member's page: their claims, casebook, shelf and posts, and for their own page the setup checklist and Saved. */
export const profilePage = createServerFn({ method: 'GET' })
  .validator((handle: string) => handle)
  .handler(async ({ data: handle }) => {
    const member = await currentMember();
    const page = await withStore(async (store) => await store.socialProfiles.page(handle, member?.id ?? null));
    if (!page) return null;
    const now = new Date();
    const { ledger, record, heat, roles, checklist } = page;
    const latestYear = now.getFullYear() + 1;
    return {
      profile: page.profile,
      own: page.own,
      signedIn: member !== null,
      canVouch: page.canVouch,
      following: page.following,
      counts: { followers: page.counts.followers, following: page.counts.following },
      /* Shown only for a member's invite, and only while the inviter's own profile is public. */
      invitedBy: page.invitedBy && { handle: page.invitedBy.handle, name: page.invitedBy.name },
      accounts: ledger.accounts.map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, url: a.url })),
      claims: ledger.claims.map((c) => ({
        id: c.id,
        kind: c.kind,
        label: c.label,
        source: c.source,
        state: c.review.state,
        /* Self-declared experience draws its own dashed tick until peers vouch for it, as tickState() says. */
        tick: c.source === 'self' && c.review.state === 'pending' ? ('self' as const) : c.review.state,
        vouches: c.vouches,
        vouchedByViewer: c.vouchedByViewer,
        when: claimWhen(c),
        due: renewsIn(c, now),
      })),
      posts: page.posts,
      record: { answers: record.answers, rated: record.rated, sound: record.sound, partly: record.partly, unsound: record.unsound },
      heat: { industries: heat.industries, cells: heat.cells, entries: heat.entries, cosigned: heat.cosigned },
      roles,
      latestYear,
      firstYear: roles.length ? Math.min(...roles.map((r) => r.from)) : latestYear,
      shelf: page.shelf,
      saved: page.saved,
      checklist: checklist && { ticked: checklist.ticked, headline: checklist.headline, casebook: checklist.casebook, answered: checklist.answered, badge: checklist.badge },
    };
  });

export const follow = createServerFn({ method: 'POST' })
  .validator((input: { handle: string }) => input)
  .handler(
    action({ access: 'member', input: z.object({ handle: token }), refusals: followRefusals }, async ({ actor, input, store }) => {
      const followed = await store.socialProfiles.follow(actor.id, input.handle);
      return followed.ok ? done(null) : followed;
    }),
  );

export const unfollow = createServerFn({ method: 'POST' })
  .validator((input: { handle: string }) => input)
  .handler(
    action({ access: 'member', input: z.object({ handle: token }) }, async ({ actor, input, store }) => {
      await store.socialProfiles.unfollow(actor.id, input.handle);
      return done(null);
    }),
  );

/** A member with the seal vouches for someone's self-declared experience. The third vouch ticks it. */
export const vouch = createServerFn({ method: 'POST' })
  .validator((input: { claim: number }) => input)
  .handler(
    action({ access: 'member', input: z.object({ claim: numberId }), refusals: vouchRefusals }, async ({ actor, input, store }) => {
      const vouched = await store.socialClaims.vouch(actor.id, input.claim);
      return vouched.ok ? done({ ticked: vouched.value.review.state === 'ticked' }) : vouched;
    }),
  );

/** The signed-in member's profile to edit, or whether they may claim a handle. Null when signed out. */
export const editPage = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) return null;
  return withStore(async (store) => {
    const profile = await store.socialProfiles.ownProfile(member.id);
    /* Social is invite-only: a member without a profile needs a way in, or the club's approval, before a handle. */
    const mayClaim = profile !== null || (await store.socialProfiles.mayClaim(member.id));
    return { name: member.name, email: member.email, profile, mayClaim };
  });
});

/** Saves the signed-in member's profile, claiming the handle first when they have none. */
export const saveProfile = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof profileSchema>) => input)
  .handler(
    action({ access: 'member', input: profileSchema }, async ({ actor, input, store }) => {
      const { handle, ...fields } = input;
      const saved = await store.socialProfiles.save(actor.id, handle ?? null, fields);
      if (saved.ok) return done({ handle: saved.value.handle });
      /* Every refusal comes before a handle is claimed, and is about the handle, so it shows beside it. */
      return refused(saveRefusals[saved.reason], { handle: saveRefusals[saved.reason] });
    }),
  );
