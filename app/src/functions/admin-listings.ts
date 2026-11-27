import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { LISTING_LIMITS, listingPath } from '../../../src/data/directory.ts';
import { capitalised, formatDay, numberWord } from '../../../src/lib/format.ts';
import { tidy } from '../../../src/lib/text.ts';
import { decisionOf, listingApprovedLetter, listingReturnedLetter, type DecisionRefusal, type Listing } from '../../../src/server/listings.ts';
import { id } from '../lib/fields.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

const decisionRefusals: Record<DecisionRefusal, string> = {
  'not-found': 'That listing is no longer here.',
  changed: 'The member changed the listing after you opened this page. Read it again before you decide.',
  already: 'Another host has already decided that. Nothing was sent.',
};

const standing = (l: Listing): string => {
  if (l.review.state === 'pending') return `Sent ${formatDay(l.updatedAt)}${l.paused ? '. Paused by the member, so it stays hidden once approved until they unpause it.' : '.'}`;
  if (l.review.state === 'returned') return 'Returned with a note. Waiting for the member to change it.';
  if (l.shown) return `In the directory since ${formatDay(l.review.approvedAt)}.`;
  return l.paused ? `Approved ${formatDay(l.review.approvedAt)}. Paused by the member.` : `Approved ${formatDay(l.review.approvedAt)}. Hidden while the membership is unpaid or suspended.`;
};

/** A listing as the hosts' check shows it: the entry itself, where it stands, and where it is in the directory. */
const forCheck = (l: Listing) => ({
  listing: { memberId: l.memberId, name: l.name, practice: l.practice, state: l.state, town: l.town, remote: l.remote, services: l.services, niche: l.niche, bio: l.bio, qualifications: l.qualifications, website: l.website, contactEmail: l.contactEmail },
  email: l.email,
  seen: l.updatedAt,
  review: l.review,
  standing: standing(l),
  href: l.shown ? listingPath(l) : null,
});

/** Listings waiting for a check, oldest first, and every other listing. */
export const adminListings = createServerFn({ method: 'GET' }).handler(async () => {
  await admit('admin', toClub);
  const { waiting, rest } = await withStore(async (store) => await store.listings.forHosts());
  return {
    title: waiting.length === 0 ? 'Nothing to check.' : `${capitalised(numberWord(waiting.length))} ${waiting.length === 1 ? 'listing' : 'listings'} to check.`,
    waiting: waiting.map(forCheck),
    rest: rest.map(forCheck),
    noteMax: LISTING_LIMITS.note,
  };
});

const decision = z.object({ member: id, seen: z.string().min(1) });

/** Approves a listing as the host read it. The member is emailed. Answers what the public now sees. */
export const approveListing = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof decision>) => input)
  .handler(
    action({ access: 'admin', input: decision, refusals: decisionRefusals }, async ({ actor, input, store, send }) => {
      const result = await store.listings.approve(input.member, actor.id, input.seen);
      if (!result.ok) return result;
      send([listingApprovedLetter(result.value, actor, absolute('/'))]);
      return done(decisionOf(result.value));
    }),
  );

const sendBack = decision.extend({
  note: z
    .string()
    .transform(tidy)
    .pipe(z.string().min(1, 'Say what needs to change.').max(LISTING_LIMITS.note, `Keep the note under ${LISTING_LIMITS.note} characters.`)),
});

/** Returns a listing, or takes a listed one down, with a note the member gets by email word for word. */
export const returnListing = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof sendBack>) => input)
  .handler(
    action({ access: 'admin', input: sendBack, refusals: decisionRefusals }, async ({ actor, input, store, send }) => {
      const result = await store.listings.sendBack(input.member, input.seen, input.note);
      if (!result.ok) return result;
      send([listingReturnedLetter(result.value, input.note, actor, absolute('/'))]);
      return done(decisionOf(result.value));
    }),
  );
