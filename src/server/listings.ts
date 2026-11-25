import { listingPath, services, states, type ServiceSlug, type State } from '../data/directory.ts';
import { site } from '../data/site.ts';
import { firstName } from '../lib/format.ts';
import { GRACE_MS } from './billing.ts';
import { STATUS_SQL } from './club.ts';
import { attempt, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import type { Letter } from './letters.ts';
import type { Result } from './result.ts';

/** What a member writes about their practice. All of it is shown in the directory. */
export interface ListingContent {
  readonly practice: string;
  readonly state: State;
  readonly town: string;
  /** Takes clients anywhere in Malaysia, not only near the town. */
  readonly remote: boolean;
  /** At least one, in the registry's order. */
  readonly services: readonly ServiceSlug[];
  /** Empty when the practice has none. */
  readonly niche: string;
  readonly bio: string;
  readonly qualifications: string;
  readonly website: string | null;
  readonly contactEmail: string;
}

/** Where a listing stands with the hosts, derived from approved_at and returned_note. Pausing is separate and never changes it. */
export type Review = { readonly state: 'pending' } | { readonly state: 'returned'; readonly note: string } | { readonly state: 'listed'; readonly approvedAt: string };

/** A listing as the public directory shows it. */
export interface PublicListing extends ListingContent {
  readonly memberId: number;
  /** The member's name, as the club has it. */
  readonly name: string;
}

/** A listing as its member and the hosts see it. */
export interface Listing extends PublicListing {
  /** The member's own address, where the club writes. Never shown in the directory. */
  readonly email: string;
  /** Moves only when the content changes, so a host's decision applies to the version they read. */
  readonly updatedAt: string;
  readonly review: Review;
  readonly paused: boolean;
  /** In the public directory right now. */
  readonly shown: boolean;
}

/**
 * What a save did. Submitted: a first listing. Resubmitted: a listed or returned one, now back with the hosts.
 * Updated: still waiting for a check, with new content. Unchanged: nothing to save.
 */
export type SaveOutcome = 'submitted' | 'resubmitted' | 'updated' | 'unchanged';

export interface DirectoryFilter {
  readonly state?: State | undefined;
  readonly service?: ServiceSlug | undefined;
}

export interface Directory {
  /** Every practice the public can see, before the filter. */
  readonly total: number;
  /** Practices that match: in the state asked for, or anywhere when none is asked. Sorted by state, then practice. */
  readonly matches: readonly PublicListing[];
  /** With a state asked for: matching practices based elsewhere that take clients anywhere in Malaysia. */
  readonly anywhere: readonly PublicListing[];
}

export type DecisionRefusal = 'not-found' | 'changed' | 'already';

const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The one rule for what the public sees: approved, not paused, and a member who is active and either an admin or paid
 * up, the grace period included, as for the members' area. Binds the time once, wherever it appears.
 */
const SHOWN = `l.approved_at IS NOT NULL AND l.paused = 0 AND (${STATUS_SQL.active}) AND (m.role = 'admin' OR EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.member_id = m.id
    AND julianday(s.paid_until) + CASE s.renews WHEN 1 THEN ${GRACE_MS / DAY_MS} ELSE 0 END > julianday(?)))`;
const LISTINGS = `SELECT l.*, m.name, m.email, (${SHOWN}) AS shown FROM listings l JOIN members m ON m.id = l.member_id`;

/** The registry's services that were chosen, in the registry's order. Anything the registry no longer has is dropped. */
const inOrder = (chosen: readonly unknown[]): ServiceSlug[] => services.map((s) => s.slug).filter((slug) => chosen.includes(slug));

const servicesOf = (row: Row): ServiceSlug[] => {
  const stored: unknown = JSON.parse(text(row, 'services'));
  if (!Array.isArray(stored)) throw new TypeError('services is not a list');
  return inOrder(stored);
};

const reviewOf = (row: Row): Review => {
  const approvedAt = optionalText(row, 'approved_at');
  if (approvedAt !== null) return { state: 'listed', approvedAt };
  const note = optionalText(row, 'returned_note');
  return note === null ? { state: 'pending' } : { state: 'returned', note };
};

const toPublic = (row: Row): PublicListing => ({
  memberId: integer(row, 'member_id'),
  name: text(row, 'name'),
  practice: text(row, 'practice'),
  state: oneOf(row, 'state', states),
  town: text(row, 'town'),
  remote: integer(row, 'remote') === 1,
  services: servicesOf(row),
  niche: text(row, 'niche'),
  bio: text(row, 'bio'),
  qualifications: text(row, 'qualifications'),
  website: optionalText(row, 'website'),
  contactEmail: text(row, 'contact_email'),
});

const toListing = (row: Row): Listing => ({
  ...toPublic(row),
  email: text(row, 'email'),
  updatedAt: text(row, 'updated_at'),
  review: reviewOf(row),
  paused: integer(row, 'paused') === 1,
  shown: integer(row, 'shown') === 1,
});

/** The content in a fixed shape, so two versions compare as equal when they read the same. */
const fingerprint = (content: ListingContent) =>
  JSON.stringify([
    content.practice,
    content.state,
    content.town,
    content.remote,
    inOrder(content.services),
    content.niche,
    content.bio,
    content.qualifications,
    content.website,
    content.contactEmail,
  ]);

/** Members' practices in the public directory, and the hosts' checks. */
export function createListings(db: Db, now: () => Date = () => new Date()) {
  const listing = (memberId: number): Listing | null => {
    const row = db.prepare(`${LISTINGS} WHERE l.member_id = ?`).get(iso(now()), memberId);
    return row ? toListing(row) : null;
  };

  /** A host's decision on the version they read. Making the same decision twice is refused, so a member hears once. */
  const decide = (memberId: number, seen: string, next: Review['state'], write: () => void): Result<Listing, DecisionRefusal> =>
    attempt<Listing, DecisionRefusal>(db, (refuse) => {
      const current = listing(memberId) ?? refuse('not-found');
      if (current.updatedAt !== seen) refuse('changed');
      if (current.review.state === next) refuse('already');
      write();
      return listing(memberId) ?? refuse('not-found');
    });

  return {
    /** The member's own listing, or null before they write one. */
    listing,

    /**
     * Saves what the member wrote. Changed content goes back to the hosts: any approval or note is cleared and it leaves
     * the directory until a host checks it. So does saving a returned listing, which is how a member answers the note.
     * Saving the same content again changes nothing. Pausing is kept as it was.
     */
    save(memberId: number, content: ListingContent): { readonly listing: Listing; readonly outcome: SaveOutcome } {
      return db.transaction(() => {
        const before = listing(memberId);
        const changed = !before || fingerprint(before) !== fingerprint(content);
        const outcome: SaveOutcome = !before
          ? 'submitted'
          : before.review.state === 'returned' || (changed && before.review.state === 'listed')
            ? 'resubmitted'
            : changed
              ? 'updated'
              : 'unchanged';
        if (outcome !== 'unchanged') {
          db.prepare(
            `INSERT INTO listings (member_id, practice, state, town, remote, services, niche, bio, qualifications, website, contact_email, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (member_id) DO UPDATE SET practice = excluded.practice, state = excluded.state, town = excluded.town,
               remote = excluded.remote, services = excluded.services, niche = excluded.niche, bio = excluded.bio,
               qualifications = excluded.qualifications, website = excluded.website, contact_email = excluded.contact_email,
               updated_at = excluded.updated_at, approved_at = NULL, approved_by = NULL, returned_note = NULL`,
          ).run(
            memberId,
            content.practice,
            content.state,
            content.town,
            content.remote ? 1 : 0,
            JSON.stringify(inOrder(content.services)),
            content.niche,
            content.bio,
            content.qualifications,
            content.website,
            content.contactEmail,
            iso(now()),
          );
        }
        const after = listing(memberId);
        if (!after) throw new Error(`Listing for member ${memberId} vanished`);
        return { listing: after, outcome };
      });
    },

    /** Takes the listing out of the directory, or puts it back. Approval stays as it was. Null when there is no listing. */
    setPaused(memberId: number, paused: boolean): Listing | null {
      db.prepare('UPDATE listings SET paused = ? WHERE member_id = ?').run(paused ? 1 : 0, memberId);
      return listing(memberId);
    },

    /**
     * What the public sees, filtered. A state filter also finds practices based elsewhere that take clients anywhere in
     * Malaysia, kept apart so the page can say which is which.
     */
    directory({ state, service }: DirectoryFilter): Directory {
      const shown = db
        .prepare(`SELECT l.*, m.name FROM listings l JOIN members m ON m.id = l.member_id WHERE ${SHOWN} ORDER BY l.state, l.practice COLLATE NOCASE, l.member_id`)
        .all(iso(now()))
        .map(toPublic);
      const offering = service ? shown.filter((l) => l.services.includes(service)) : shown;
      if (!state) return { total: shown.length, matches: offering, anywhere: [] };
      return {
        total: shown.length,
        matches: offering.filter((l) => l.state === state),
        anywhere: offering.filter((l) => l.state !== state && l.remote),
      };
    },

    /** Every listing, for the hosts: those waiting for a check, oldest first, then the rest by practice. */
    forHosts(): { readonly waiting: Listing[]; readonly rest: Listing[] } {
      const all = db.prepare(`${LISTINGS} ORDER BY l.updated_at, l.member_id`).all(iso(now())).map(toListing);
      return {
        waiting: all.filter((l) => l.review.state === 'pending'),
        rest: all.filter((l) => l.review.state !== 'pending').sort((a, b) => a.practice.localeCompare(b.practice, 'en-MY', { sensitivity: 'base' })),
      };
    },

    /** Lists the version the host read. Refused if the member has changed it since, or it is already listed. */
    approve(memberId: number, hostId: number, seen: string): Result<Listing, DecisionRefusal> {
      return decide(memberId, seen, 'listed', () => {
        db.prepare('UPDATE listings SET approved_at = ?, approved_by = ?, returned_note = NULL WHERE member_id = ?').run(iso(now()), hostId, memberId);
      });
    },

    /** Sends the version the host read back to the member with a note. A listed one leaves the directory. */
    sendBack(memberId: number, seen: string, note: string): Result<Listing, DecisionRefusal> {
      return decide(memberId, seen, 'returned', () => {
        db.prepare('UPDATE listings SET approved_at = NULL, approved_by = NULL, returned_note = ? WHERE member_id = ?').run(note, memberId);
      });
    },
  };
}

/*
 * The directory's emails. Admins hear when a listing joins the queue, not on each edit while it waits. The member hears
 * from the host who checked it, at the address they signed up with, never the contact address they typed.
 */

const hi = (name: string) => `Hi ${firstName(name)},`;
const flat = (value: string) => value.replace(/\s+/g, ' ').trim();
const fromHost = (host: { readonly name: string }) => `${firstName(host.name)} from ${site.name}`;

/** Tells the admins a listing waits for a check. Only ever sent to them. */
export function listingQueuedLetter(admins: readonly string[], listing: Listing, outcome: 'submitted' | 'resubmitted', adminUrl: string): Letter {
  const place = `${listing.town}, ${listing.state}`;
  return {
    to: admins,
    subject: flat(outcome === 'submitted' ? `${listing.name} wants to be in the directory` : `${listing.name} changed their directory listing`),
    lines: [
      outcome === 'submitted'
        ? `${listing.name} sent a listing for ${listing.practice} (${place}). It goes in the directory once a host approves it.`
        : `${listing.name} changed the listing for ${listing.practice} (${place}). It stays out of the directory until a host checks it again.`,
      'Check that they are who they say, and that the practice is real and theirs. You are not vouching for their work.',
      { href: adminUrl, label: 'Check the listing' },
    ],
  };
}

/** Tells the member their practice is in the directory. */
export function listingListedLetter(listing: Listing, host: { readonly name: string }, siteUrl: string): Letter {
  return {
    to: listing.email,
    from: fromHost(host),
    subject: 'Your practice is in the directory',
    lines: [
      hi(listing.name),
      `${listing.practice} is now in the club's directory, where business owners look for an accountant.`,
      { href: new URL(listingPath(listing), siteUrl).href, label: 'See your listing' },
      'Enquiries come straight to you, by email or through your website. The club never sees them.',
      { href: new URL('/members/listing', siteUrl).href, text: 'Too busy for new clients? Pause it from your listing page, and unpause it when you have room.' },
      'If you change what it says, a host checks it again before it goes back up.',
      firstName(host.name),
    ],
  };
}

/** Tells the member a host sent their listing back, with the host's note. */
export function listingReturnedLetter(listing: Listing, note: string, host: { readonly name: string }, siteUrl: string): Letter {
  return {
    to: listing.email,
    from: fromHost(host),
    subject: 'Your directory listing needs a change',
    lines: [
      hi(listing.name),
      `I read your listing for ${listing.practice}. It needs a change before it can be in the directory:`,
      note,
      { href: new URL('/members/listing', siteUrl).href, label: 'Change your listing' },
      'Save it and it comes back to us to check. Questions? Reply to this email.',
      firstName(host.name),
    ],
  };
}
