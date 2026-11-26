import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { HANDLE, HANDLE_TAKEN, JURISDICTIONS, PROFILE_LIMITS, SECTORS, TOPICS, TRACKS, type Topic, type Track } from '../../../src/data/social.ts';
import { claimWhen, renewsIn } from '../../../src/lib/ticks.ts';
import type { VouchRefusal } from '../../../src/server/social-claims.ts';
import { handleProblem, normaliseHandle, type ClaimRefusal, type FollowRefusal, type HandleRefusal, type Profile } from '../../../src/server/social-profiles.ts';
import { numberId, oneLine, token } from '../lib/fields.ts';
import { memberOrRefusal } from '../lib/guards.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/* Profiles: The List, a member's page, following, vouching, and editing your own. */

export const handleRefusals: Record<HandleRefusal, string> = {
  'handle-invalid': `Use ${HANDLE.min} to ${HANDLE.max} lowercase letters, digits or underscores.`,
  'handle-reserved': 'That handle is kept for the team. Pick another.',
  'handle-taken': HANDLE_TAKEN,
};

const claimRefusals: Record<ClaimRefusal, string> = {
  ...handleRefusals,
  'already-claimed': 'You already have a handle.',
  'not-invited': 'Social is invite-only. Use an invite link, or ask to join.',
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

/** A profile as plain data, without the store's stub on it, so it can travel to the page. */
const profileOf = (p: Profile): Profile => ({
  memberId: p.memberId,
  handle: p.handle,
  name: p.name,
  track: p.track,
  sealed: p.sealed,
  createdAt: p.createdAt,
  headline: p.headline,
  sector: p.sector,
  city: p.city,
  jurisdictions: p.jurisdictions,
  topics: p.topics,
  creator: p.creator,
  listed: p.listed,
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
    const viewerId = member?.id ?? null;
    const now = new Date();
    return withStore(async (store) => {
      const profile = await store.socialProfiles.profile(handle);
      if (!profile) return null;
      const own = member !== null && profile.memberId === member.id;
      const viewer = member ? await store.socialProfiles.ownProfile(member.id) : null;
      const ledger = await store.socialClaims.ledger(profile.memberId, viewerId);
      const roles = await store.socialCasebook.roles(profile.memberId);
      const latestYear = now.getFullYear() + 1;
      const counts = await store.socialProfiles.followCounts(profile.memberId);
      const invitedBy = await store.socialProfiles.invitedBy(profile.memberId);
      const record = await store.socialProblems.record(profile.memberId);
      const heat = await store.socialCasebook.heatmap(profile.memberId);
      const checklist = own && member ? await store.socialProfiles.checklist(member.id) : null;
      return {
        profile: profileOf(profile),
        own,
        signedIn: member !== null,
        /* Only members with the seal vouch, and never for themselves. Others see the count. */
        canVouch: !own && (viewer?.sealed ?? false),
        following: member && !own ? await store.socialProfiles.isFollowing(member.id, profile.memberId) : false,
        counts: { followers: counts.followers, following: counts.following },
        /* Shown only for a member's invite, and only while the inviter's own profile is public. */
        invitedBy: invitedBy && { handle: invitedBy.handle, name: invitedBy.name },
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
        posts: await store.socialFloor.recentPosts(viewerId, profile.memberId),
        record: { answers: record.answers, rated: record.rated, sound: record.sound, partly: record.partly, unsound: record.unsound },
        heat: { industries: heat.industries, cells: heat.cells, entries: heat.entries, cosigned: heat.cosigned },
        roles,
        latestYear,
        firstYear: roles.length ? Math.min(...roles.map((r) => r.from)) : latestYear,
        shelf: await store.socialShelf.shelf(profile.memberId, viewerId),
        saved: own && member ? await store.socialShelf.saved(member.id) : [],
        checklist: checklist && { ticked: checklist.ticked, headline: checklist.headline, casebook: checklist.casebook, answered: checklist.answered, badge: checklist.badge },
      };
    });
  });

export const follow = createServerFn({ method: 'POST' })
  .validator((input: { handle: string }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = parsed(z.object({ handle: token }), data);
    if (!input.ok) return input;
    const result = await withStore(async (store) => await store.socialProfiles.follow(member.value.id, input.value.handle));
    return result.ok ? done(null) : refused(followRefusals[result.reason]);
  });

export const unfollow = createServerFn({ method: 'POST' })
  .validator((input: { handle: string }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = parsed(z.object({ handle: token }), data);
    if (!input.ok) return input;
    await withStore(async (store) => await store.socialProfiles.unfollow(member.value.id, input.value.handle));
    return done(null);
  });

/** A member with the seal vouches for someone's self-declared experience. The third vouch ticks it. */
export const vouch = createServerFn({ method: 'POST' })
  .validator((input: { claim: number }) => input)
  .handler(async ({ data }): Promise<Outcome<{ ticked: boolean }>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = parsed(z.object({ claim: numberId }), data);
    if (!input.ok) return input;
    const result = await withStore(async (store) => await store.socialClaims.vouch(member.value.id, input.value.claim));
    return result.ok ? done({ ticked: result.value.review.state === 'ticked' }) : refused(vouchRefusals[result.reason]);
  });

/** The signed-in member's profile to edit, or whether they may claim a handle. Null when signed out. */
export const editPage = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) return null;
  return withStore(async (store) => {
    const profile = await store.socialProfiles.ownProfile(member.id);
    /* Social is invite-only: a member without a profile needs a way in, or the club's approval, before a handle. */
    const mayClaim = profile !== null || (await store.socialProfiles.mayClaim(member.id));
    return { name: member.name, email: member.email, profile: profile && profileOf(profile), mayClaim };
  });
});

/** Saves the signed-in member's profile, claiming the handle first when they have none. */
export const saveProfile = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof profileSchema>) => input)
  .handler(async ({ data }): Promise<Outcome<{ handle: string }>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = parsed(profileSchema, data);
    if (!input.ok) return input;
    const { handle, ...fields } = input.value;
    return withStore(async (store): Promise<Outcome<{ handle: string }>> => {
      if (!(await store.socialProfiles.ownProfile(member.value.id))) {
        /* Before a handle is claimed, every refusal is about the handle, so it shows beside it. */
        if (!handle) return refused('Pick a handle first.', { handle: 'Pick a handle first.' });
        const claim = await store.socialProfiles.claimHandle(member.value.id, handle);
        if (!claim.ok) return refused(claimRefusals[claim.reason], { handle: claimRefusals[claim.reason] });
      }
      const profile = await store.socialProfiles.update(member.value.id, fields);
      return profile ? done({ handle: profile.handle }) : refused('Your profile was not saved. Try again.');
    });
  });
