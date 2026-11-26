import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { isServiceSlug, LISTING_LIMITS, states, type ServiceSlug } from '../../../src/data/directory.ts';
import { tidy } from '../../../src/server/community.ts';
import { listingQueuedLetter, type SaveOutcome } from '../../../src/server/listings.ts';
import { email, oneLine } from '../lib/fields.ts';
import { paidOrRefusal } from '../lib/guards.server.ts';
import { tooManyTries } from '../lib/action.ts';
import { allowed } from '../lib/limits.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { paidMemberOrRedirect } from '../lib/members.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

export const membersListing = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await paidMemberOrRedirect();
  const listing = await withStore(async (store) => store.listings.listing(member.id));
  return { email: member.email, listing };
});
const line = (field: string, max: number) =>
  z
    .string()
    .transform(oneLine)
    .pipe(z.string().min(1, `Enter ${field}.`).max(max, `Keep it under ${max} characters.`));

/** A bare domain gets https:// in front, since that is how most people type their address. Plain http is refused. */
const website = z
  .string()
  .trim()
  .max(LISTING_LIMITS.website, `Keep the address under ${LISTING_LIMITS.website} characters.`)
  .transform((value) => (/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`))
  .pipe(z.url({ protocol: /^https$/, hostname: /^([a-z\d-]+\.)+[a-z]{2,}$/i, message: 'Enter the address of your website, like rahman.com.my. It must use https.' }));

const service = z.custom<ServiceSlug>((value) => typeof value === 'string' && isServiceSlug(value), 'Pick from the list.');
/** A field left blank is no answer, as the form sent it before. */
const blankIsNone = <S extends z.ZodType>(schema: S) => z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const listingInput = z.object({
  practice: line('the name of your practice', LISTING_LIMITS.practice),
  state: z.enum(states, 'Pick the state your practice is in.'),
  town: line('the town or city', LISTING_LIMITS.town),
  remote: z.boolean(),
  services: z.array(service).min(1, 'Pick at least one service.'),
  niche: blankIsNone(z.string().transform(oneLine).pipe(z.string().max(LISTING_LIMITS.niche, `Keep it under ${LISTING_LIMITS.niche} characters.`))),
  bio: z
    .string()
    .transform(tidy)
    .pipe(z.string().min(1, 'Write a few lines about your practice.').max(LISTING_LIMITS.bio, `Keep it under ${LISTING_LIMITS.bio} characters.`)),
  qualifications: line('your qualifications', LISTING_LIMITS.qualifications),
  website: blankIsNone(website),
  contactEmail: email,
  declared: z.literal(true, 'Tick the declaration to send your listing.'),
});

/** The form as typed: every field a string, the boxes ticked or not. */
export interface ListingForm {
  readonly practice: string;
  readonly state: string;
  readonly town: string;
  readonly remote: boolean;
  readonly services: readonly string[];
  readonly niche: string;
  readonly bio: string;
  readonly qualifications: string;
  readonly website: string;
  readonly contactEmail: string;
  readonly declared: boolean;
}

export const saveListing = createServerFn({ method: 'POST' })
  .validator((input: ListingForm) => input)
  .handler(async ({ data }): Promise<Outcome<{ outcome: SaveOutcome }>> => {
    const input = await parsed(listingInput, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    if (!(await allowed('listing'))) return refused(tooManyTries);
    const { declared: _declared, niche, website: site, ...content } = input.value;
    const saved = await withStore(async (store) => {
      const { listing, outcome } = await store.listings.save(member.value.id, { ...content, niche: niche ?? '', website: site ?? null });
      const queued = outcome === 'submitted' || outcome === 'resubmitted' ? { listing, outcome, admins: await store.club.adminEmails() } : null;
      return { outcome, queued };
    });
    if (saved.queued?.admins.length) sendLater([listingQueuedLetter(saved.queued.admins, saved.queued.listing, saved.queued.outcome, absolute('/admin/listings'))]);
    return done({ outcome: saved.outcome });
  });

const pauseInput = z.object({ paused: z.boolean() });

export const pauseListing = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof pauseInput>) => input)
  .handler(async ({ data }): Promise<Outcome<{ paused: boolean }>> => {
    const input = await parsed(pauseInput, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    const listing = await withStore(async (store) => {
      const found = await store.listings.setPaused(member.value.id, input.value.paused);
      return found && { paused: found.paused };
    });
    return listing ? done(listing) : refused('Write your listing first.');
  });
