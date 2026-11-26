import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { SHELF_KINDS, SHELF_LIMITS, socialHost } from '../../../src/data/social.ts';
import type { SaveRefusal, ShelfRefusal } from '../../../src/server/social-shelf.ts';
import { numberId, oneLine } from '../lib/fields.ts';
import { memberOrRefusal } from '../lib/guards.server.ts';
import { tooManyTries } from '../lib/action.ts';
import { allowed } from '../lib/limits.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/* A member's shelf of links to public work, saving other people's, and the badge for their bio. */

const shelfRefusals: Record<ShelfRefusal, string> = {
  'no-handle': 'Claim your handle first. Your casebook and shelf show on your profile.',
  url: 'Use a full https link to where the work is public.',
  full: `A shelf holds ${SHELF_LIMITS.items} items. Take one down first.`,
};
const saveRefusals: Record<SaveRefusal, string> = {
  'not-found': 'That item is no longer on the shelf.',
  self: 'It is already on your shelf.',
};

const shelfSchema = z.object({
  kind: z.enum(SHELF_KINDS, 'Pick what it is.'),
  title: z.string('Give it a title.').transform(oneLine).pipe(z.string().min(1, 'Give it a title.').max(SHELF_LIMITS.title, `Keep it under ${SHELF_LIMITS.title} characters.`)),
  url: z.string('Paste the link.').trim().min(1, 'Paste the link.').max(SHELF_LIMITS.url, `Keep the link under ${SHELF_LIMITS.url} characters.`),
});

export const addShelfItem = createServerFn({ method: 'POST' })
  .validator((input: { kind: string; title: string; url: string }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = await parsed(shelfSchema, data);
    if (!input.ok) return input;
    if (!(await allowed('shelf'))) return refused(tooManyTries);
    const result = await withStore(async (store) => await store.socialShelf.add(member.value.id, input.value));
    return result.ok ? done(null) : refused(shelfRefusals[result.reason]);
  });

/** Takes an item down. It leaves everyone's Saved too. */
export const removeShelfItem = createServerFn({ method: 'POST' })
  .validator((input: { item: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = await parsed(z.object({ item: numberId }), data);
    if (!input.ok) return input;
    await withStore(async (store) => await store.socialShelf.remove(member.value.id, input.value.item));
    return done(null);
  });

export const saveItem = createServerFn({ method: 'POST' })
  .validator((input: { item: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = await parsed(z.object({ item: numberId }), data);
    if (!input.ok) return input;
    const result = await withStore(async (store) => await store.socialShelf.save(member.value.id, input.value.item));
    return result.ok ? done(null) : refused(saveRefusals[result.reason]);
  });

export const unsaveItem = createServerFn({ method: 'POST' })
  .validator((input: { item: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const input = await parsed(z.object({ item: numberId }), data);
    if (!input.ok) return input;
    await withStore(async (store) => await store.socialShelf.unsave(member.value.id, input.value.item));
    return done(null);
  });

/** The badge page: the line for a bio and what people see when they tap it. Needs the seal. */
export const badgePage = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) return { signedIn: false as const };
  return withStore(async (store) => {
    const profile = await store.socialProfiles.ownProfile(member.id);
    if (!profile?.sealed) return { signedIn: true as const, badge: null };
    const credential = await store.socialProfiles.credential(member.id);
    const ledger = await store.socialClaims.ledger(member.id, member.id);
    /* The link people tap goes to the social host whichever host this page is on. */
    const link = `https://${socialHost}/@${profile.handle}`;
    /* A seal resting on a workplace or experience has no credential to name, as on the Floor. */
    const named = credential !== 'member';
    const shown = [
      ...ledger.accounts.map((a) => ({ key: `a${a.id}`, source: 'account' as const, label: `${a.platform} · @${a.handle}` })),
      ...ledger.claims.filter((c) => c.review.state === 'ticked').map((c) => ({ key: `c${c.id}`, source: c.source, label: c.label })),
    ].slice(0, 4);
    return {
      signedIn: true as const,
      badge: { profile: { name: profile.name, handle: profile.handle, track: profile.track, sealed: profile.sealed }, link, credential: named ? credential : null, bio: named ? `Ticked: ${credential}. ${link}` : `Ticked on TRIA. ${link}`, shown },
    };
  });
});

/** The member copied a line from the badge page, so their setup checklist can tick it off. */
export const badgeCopied = createServerFn({ method: 'POST' }).handler(async (): Promise<Outcome<null>> => {
  const member = await memberOrRefusal();
  if (!member.ok) return member;
  await withStore(async (store) => await store.socialProfiles.badgeCopied(member.value.id));
  return done(null);
});
