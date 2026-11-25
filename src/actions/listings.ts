import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { isServiceSlug, LISTING_LIMITS, states, type ServiceSlug } from '../data/directory.ts';
import { tidy } from '../server/community.ts';
import { listingListedLetter, listingQueuedLetter, listingReturnedLetter, type DecisionRefusal } from '../server/listings.ts';
import { absolute, admin, email, id, oneLine, paidMember, sendLater, settle, throttle, type Refusal } from './guards.ts';

const decisionRefusals: Record<DecisionRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That listing is no longer here.' },
  changed: { code: 'CONFLICT', message: 'The member changed the listing after you opened this page. Read it again before you decide.' },
  already: { code: 'CONFLICT', message: 'Another host has already decided that. Nothing was sent.' },
};

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

export const listings = {
  saveListing: defineAction({
    accept: 'form',
    input: z.object({
      practice: line('the name of your practice', LISTING_LIMITS.practice),
      state: z.enum(states, 'Pick the state your practice is in.'),
      town: line('the town or city', LISTING_LIMITS.town),
      remote: z.boolean(),
      services: z.array(service).min(1, 'Pick at least one service.'),
      niche: z.string().transform(oneLine).pipe(z.string().max(LISTING_LIMITS.niche, `Keep it under ${LISTING_LIMITS.niche} characters.`)).optional(),
      bio: z
        .string()
        .transform(tidy)
        .pipe(z.string().min(1, 'Write a few lines about your practice.').max(LISTING_LIMITS.bio, `Keep it under ${LISTING_LIMITS.bio} characters.`)),
      qualifications: line('your qualifications', LISTING_LIMITS.qualifications),
      website: website.optional(),
      contactEmail: email,
      declared: z.literal('on', 'Tick the declaration to send your listing.'),
    }),
    handler: async ({ declared: _declared, niche, website, ...content }, context) => {
      const member = await paidMember(context.locals);
      await throttle(context, 'listing');
      const { listing, outcome } = await context.locals.listings.save(member.id, { ...content, niche: niche ?? '', website: website ?? null });
      if (outcome === 'submitted' || outcome === 'resubmitted') {
        const admins = await context.locals.club.adminEmails();
        if (admins.length) sendLater(context, [listingQueuedLetter(admins, listing, outcome, absolute(context, '/admin/listings'))]);
      }
      return { outcome };
    },
  }),

  pauseListing: defineAction({
    accept: 'form',
    input: z.object({ paused: z.enum(['true', 'false']) }),
    handler: async (input, context) => {
      const member = await paidMember(context.locals);
      const listing = await context.locals.listings.setPaused(member.id, input.paused === 'true');
      if (!listing) throw new ActionError({ code: 'NOT_FOUND', message: 'Write your listing first.' });
      return { paused: listing.paused };
    },
  }),

  approveListing: defineAction({
    accept: 'form',
    input: z.object({ member: id, seen: z.string().min(1) }),
    handler: async (input, context) => {
      const host = admin(context.locals);
      const listing = settle(await context.locals.listings.approve(input.member, host.id, input.seen), decisionRefusals);
      sendLater(context, [listingListedLetter(listing, host, absolute(context, '/'))]);
      return { practice: listing.practice, decision: 'listed' as const };
    },
  }),

  returnListing: defineAction({
    accept: 'form',
    input: z.object({
      member: id,
      seen: z.string().min(1),
      note: z
        .string()
        .transform(tidy)
        .pipe(z.string().min(1, 'Say what needs to change.').max(LISTING_LIMITS.note, `Keep the note under ${LISTING_LIMITS.note} characters.`)),
    }),
    handler: async (input, context) => {
      const host = admin(context.locals);
      const listing = settle(await context.locals.listings.sendBack(input.member, input.seen, input.note), decisionRefusals);
      sendLater(context, [listingReturnedLetter(listing, input.note, host, absolute(context, '/'))]);
      return { practice: listing.practice, decision: 'returned' as const };
    },
  }),
};
