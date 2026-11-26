import { HANDLE, JURISDICTIONS, RESERVED_HANDLES, SECTORS, statusTrack, TOPICS, type Jurisdiction, type Sector, type Topic, type Track } from '../data/social.ts';
import { STATUS_SQL } from './club.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import { fail, ok, type Result } from './result.ts';

/** What a member writes about themselves. All of it is public. */
export interface ProfileFields {
  readonly headline: string;
  readonly sector: Sector | null;
  readonly city: string;
  readonly jurisdictions: readonly Jurisdiction[];
  readonly topics: readonly Topic[];
  /** They mainly make content, rather than practise. Shown as the Creator flair when no credential outranks it. */
  readonly creator: boolean;
  /** On The List. A profile off it is still reachable by its handle. */
  readonly listed: boolean;
}

export interface Profile extends ProfileFields {
  readonly memberId: number;
  readonly handle: string;
  /** The member's name, as the club has it. */
  readonly name: string;
  readonly track: Track;
  /** One social account proven and one more claim ticked. */
  readonly sealed: boolean;
  readonly createdAt: string;
}

export interface ListEntry {
  readonly profile: Profile;
  readonly points: number;
}

export interface ListFilter {
  readonly topic?: Topic | undefined;
  readonly track?: Track | undefined;
}

/**
 * What track and seal read from a member's claims. A proven social account counts as a ticked claim of kind
 * 'account'; a body claim carries the track its status puts someone on.
 */
export interface ClaimFact {
  readonly kind: 'account' | 'body' | 'licence' | 'employer' | 'academic' | 'experience';
  readonly state: 'pending' | 'ticked' | 'rejected' | 'lapsed';
  readonly track: 'qualified' | 'training' | null;
}

export type HandleRefusal = 'handle-invalid' | 'handle-reserved' | 'handle-taken';
export type SignUpRefusal = HandleRefusal | 'email-taken';
export type ClaimRefusal = HandleRefusal | 'already-claimed';
export type FollowRefusal = 'not-found' | 'self';

/** A handle as people type it: any case, with or without the @. */
export const normaliseHandle = (raw: string) => raw.trim().replace(/^@/, '').toLowerCase();

/** Why a normalised handle cannot be used, before asking whether someone holds it. Null when it can. */
export function handleProblem(handle: string): 'handle-invalid' | 'handle-reserved' | null {
  if (!HANDLE.pattern.test(handle)) return 'handle-invalid';
  return RESERVED_HANDLES.has(handle) ? 'handle-reserved' : null;
}

/** Qualified outranks training, and either outranks the creator flair the member chose. */
export function trackOf(claims: readonly ClaimFact[], creator: boolean): Track {
  const ticked = claims.filter((claim) => claim.state === 'ticked');
  if (ticked.some((claim) => claim.track === 'qualified')) return 'qualified';
  if (ticked.some((claim) => claim.track === 'training')) return 'training';
  return creator ? 'creator' : 'field';
}

export function sealOf(claims: readonly ClaimFact[]): boolean {
  const ticked = claims.filter((claim) => claim.state === 'ticked');
  return ticked.some((claim) => claim.kind === 'account') && ticked.some((claim) => claim.kind !== 'account');
}

const FACT_KINDS = ['account', 'body', 'licence', 'employer', 'academic', 'experience'] as const;
const FACT_STATES = ['pending', 'ticked', 'rejected', 'lapsed'] as const;

/**
 * What track and seal read for a member: their claims, and their social accounts as claims of kind 'account', ticked
 * once proven. A body claim carries the track its exact status puts someone on.
 */
export function claimFacts(db: Db, memberId: number): ClaimFact[] {
  return db
    .prepare(
      `SELECT kind, state, body_id, status_level FROM claims WHERE member_id = ?
       UNION ALL
       SELECT 'account', CASE state WHEN 'proven' THEN 'ticked' ELSE state END, NULL, NULL FROM social_accounts WHERE member_id = ?`,
    )
    .all(memberId, memberId)
    .map((row) => {
      const bodyId = optionalText(row, 'body_id');
      const status = optionalText(row, 'status_level');
      return {
        kind: oneOf(row, 'kind', FACT_KINDS),
        state: oneOf(row, 'state', FACT_STATES),
        track: bodyId !== null && status !== null ? statusTrack(bodyId, status) : null,
      };
    });
}

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The registry's entries that were stored, in the registry's order. Anything the registry no longer has is dropped. */
const listOf = <const T extends string>(row: Row, column: string, allowed: readonly T[]): T[] => {
  const stored: unknown = JSON.parse(text(row, column));
  if (!Array.isArray(stored)) throw new TypeError(`${column} is not a list`);
  return allowed.filter((entry) => stored.includes(entry));
};

/** Profiles the public sees: their member has set a password, which proves the email, and is not suspended. */
const PUBLIC = STATUS_SQL.active;
const PROFILES = 'SELECT p.*, m.name FROM profiles p JOIN members m ON m.id = p.member_id';

/** Handles, profiles, follows and The List. */
export function createSocialProfiles(db: Db, now: () => Date = () => new Date()) {
  /* Peer points arrive with Problems and the shelf. Until then everyone has none. */
  const peerPoints = (_memberId: number): number => 0;

  const toProfile = (row: Row): Profile => {
    const memberId = integer(row, 'member_id');
    const creator = integer(row, 'creator') === 1;
    const claims = claimFacts(db, memberId);
    return {
      memberId,
      handle: text(row, 'handle'),
      name: text(row, 'name'),
      headline: text(row, 'headline'),
      sector: optionalText(row, 'sector') === null ? null : oneOf(row, 'sector', SECTORS),
      city: text(row, 'city'),
      jurisdictions: listOf(row, 'jurisdictions', JURISDICTIONS),
      topics: listOf(row, 'topics', TOPICS),
      creator,
      listed: integer(row, 'listed') === 1,
      track: trackOf(claims, creator),
      sealed: sealOf(claims),
      createdAt: text(row, 'created_at'),
    };
  };

  const ownProfile = (memberId: number): Profile | null => {
    const row = db.prepare(`${PROFILES} WHERE p.member_id = ?`).get(memberId);
    return row ? toProfile(row) : null;
  };

  const publicProfile = (handle: string): Profile | null => {
    const row = db.prepare(`${PROFILES} WHERE p.handle = ? AND ${PUBLIC}`).get(normaliseHandle(handle));
    return row ? toProfile(row) : null;
  };

  /** Inside a transaction: checks the handle and writes the profile, or refuses. */
  const insertProfile = (memberId: number, handle: string, refuse: (reason: HandleRefusal) => never) => {
    const problem = handleProblem(handle);
    if (problem) refuse(problem);
    if (db.prepare('SELECT 1 FROM profiles WHERE handle = ?').get(handle)) refuse('handle-taken');
    db.prepare('INSERT INTO profiles (member_id, handle, created_at, updated_at) VALUES (?, ?, ?, ?)').run(memberId, handle, iso(now()), iso(now()));
  };

  return {
    /**
     * A new member from the social site, with a handle. They start invited, like any member: the caller sends the
     * link to set a password, and the profile is public once they have. Nothing is saved when anything is refused.
     */
    signUp(input: { name: string; email: string; handle: string }): Result<{ memberId: number }, SignUpRefusal> {
      return attempt<{ memberId: number }, SignUpRefusal>(db, (refuse) => {
        if (db.prepare('SELECT 1 FROM members WHERE email = ?').get(input.email)) refuse('email-taken');
        const { lastInsertRowid } = db.prepare(`INSERT INTO members (email, name, joined_via) VALUES (?, ?, 'social')`).run(input.email, input.name);
        insertProfile(lastInsertRowid, normaliseHandle(input.handle), refuse);
        return { memberId: lastInsertRowid };
      });
    },

    /** A handle for a member who has none yet, such as a club member coming to the social site. */
    claimHandle(memberId: number, handle: string): Result<Profile, ClaimRefusal> {
      return attempt<Profile, ClaimRefusal>(db, (refuse) => {
        if (ownProfile(memberId)) refuse('already-claimed');
        insertProfile(memberId, normaliseHandle(handle), refuse);
        const claimed = ownProfile(memberId);
        if (!claimed) throw new Error(`Profile for member ${memberId} was not saved`);
        return claimed;
      });
    },

    /** The member's own profile, whatever their status. Null before they claim a handle. */
    ownProfile,

    /** A profile as the public sees it, by handle. Null when nobody public holds it. */
    profile: publicProfile,

    /** Saves what the member wrote. Null when they have no profile yet. */
    update(memberId: number, fields: ProfileFields): Profile | null {
      db.prepare(
        `UPDATE profiles SET headline = ?, sector = ?, city = ?, jurisdictions = ?, topics = ?, creator = ?, listed = ?, updated_at = ?
         WHERE member_id = ?`,
      ).run(
        fields.headline,
        fields.sector,
        fields.city,
        JSON.stringify(JURISDICTIONS.filter((j) => fields.jurisdictions.includes(j))),
        JSON.stringify(TOPICS.filter((t) => fields.topics.includes(t))),
        fields.creator ? 1 : 0,
        fields.listed ? 1 : 0,
        iso(now()),
        memberId,
      );
      return ownProfile(memberId);
    },

    /** The List: listed public profiles, highest peer points first, then the longest here. */
    list(filter: ListFilter = {}): ListEntry[] {
      return db
        .prepare(`${PROFILES} WHERE p.listed = 1 AND ${PUBLIC} ORDER BY p.created_at, p.member_id`)
        .all()
        .map(toProfile)
        .filter((profile) => (!filter.topic || profile.topics.includes(filter.topic)) && (!filter.track || profile.track === filter.track))
        .map((profile) => ({ profile, points: peerPoints(profile.memberId) }))
        .sort((a, b) => b.points - a.points);
    },

    /** Follows a public profile. Following twice changes nothing. */
    follow(followerId: number, handle: string): Result<Profile, FollowRefusal> {
      const followee = publicProfile(handle);
      if (!followee) return fail('not-found');
      if (followee.memberId === followerId) return fail('self');
      db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(followerId, followee.memberId, iso(now()));
      return ok(followee);
    },

    /** True when there was a follow to remove. */
    unfollow(followerId: number, handle: string): boolean {
      const followee = publicProfile(handle);
      if (!followee) return false;
      return db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(followerId, followee.memberId).changes > 0;
    },

    isFollowing(followerId: number, followeeId: number): boolean {
      return db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(followerId, followeeId) !== undefined;
    },

    /** Followers and followed, counting only people the public can see. */
    followCounts(memberId: number): { readonly followers: number; readonly following: number } {
      const visible = (column: string) => `EXISTS (SELECT 1 FROM members WHERE id = f.${column} AND ${PUBLIC})`;
      return {
        followers: count(db.prepare(`SELECT count(*) AS n FROM follows f WHERE f.followee_id = ? AND ${visible('follower_id')}`).get(memberId)),
        following: count(db.prepare(`SELECT count(*) AS n FROM follows f WHERE f.follower_id = ? AND ${visible('followee_id')}`).get(memberId)),
      };
    },
  };
}

export type SocialProfiles = ReturnType<typeof createSocialProfiles>;
