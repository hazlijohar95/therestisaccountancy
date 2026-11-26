import { ENTRY_VIA, HANDLE, JURISDICTIONS, RESERVED_HANDLES, SECTORS, statusTrack, TOPICS, type EntryVia, type Jurisdiction, type Sector, type Topic, type Track } from '../data/social.ts';
import { matcher } from '../lib/search.ts';
import { STATUS_SQL } from './club.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import { fail, ok, type Result } from './result.ts';
import { notify } from './social-notify.ts';

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
/** 'not-invited': Social is invite-only, and nothing has let this member in yet. */
export type ClaimRefusal = HandleRefusal | 'already-claimed' | 'not-invited';
export type FollowRefusal = 'not-found' | 'self';

/**
 * How a member got into Social, recorded once, before their profile can exist. Only a member's invite names who
 * invited them; the inviter's id goes if they are deleted, and the entry stays a member invite.
 */
export type Entry = { readonly via: Exclude<EntryVia, 'member'> } | { readonly via: 'member'; readonly inviterId: number };

/** A member the club accepted, as SQL on the members row: they joined through it, or it approved them to pay. */
export const CLUB_APPROVED_SQL = `(joined_via = 'club' OR club_approved_at IS NOT NULL)`;

/** Inside a transaction: lets the member into Social. The first way in is the one kept. True when this let them in. */
export function admit(db: Db, at: Date, memberId: number, entry: Entry): boolean {
  const inviterId = entry.via === 'member' ? entry.inviterId : null;
  return (
    db.prepare('INSERT INTO social_entries (member_id, joined_via, inviter_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (member_id) DO NOTHING').run(memberId, entry.via, inviterId, iso(at))
      .changes > 0
  );
}

/** True when something has let the member into Social already. */
export const admitted = (db: Db, memberId: number) => db.prepare('SELECT 1 FROM social_entries WHERE member_id = ?').get(memberId) !== undefined;

/** Inside a transaction: checks the handle and writes the profile, or refuses. The member must have been let in. */
export function insertProfile(db: Db, at: Date, memberId: number, handle: string, refuse: (reason: HandleRefusal) => never): void {
  const problem = handleProblem(handle);
  if (problem) refuse(problem);
  if (db.prepare('SELECT 1 FROM profiles WHERE handle = ?').get(handle)) refuse('handle-taken');
  db.prepare('INSERT INTO profiles (member_id, handle, created_at, updated_at) VALUES (?, ?, ?, ?)').run(memberId, handle, iso(at), iso(at));
}

/**
 * Inside a transaction: a new member from the social site, let in by entry, with a handle. They start invited, like any
 * member: the caller sends the link to set a password, and the profile is public once they have.
 */
export function openAccount(db: Db, at: Date, input: { name: string; email: string; handle: string }, entry: Entry, refuse: (reason: SignUpRefusal) => never): number {
  if (db.prepare('SELECT 1 FROM members WHERE email = ?').get(input.email)) refuse('email-taken');
  const { lastInsertRowid } = db.prepare(`INSERT INTO members (email, name, joined_via, joined_at) VALUES (?, ?, 'social', ?)`).run(input.email, input.name, iso(at));
  admit(db, at, lastInsertRowid, entry);
  insertProfile(db, at, lastInsertRowid, normaliseHandle(input.handle), refuse);
  return lastInsertRowid;
}

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

/**
 * sealOf as SQL, for lists that filter and page in the database. memberColumn is the outer query's qualified column,
 * like p.member_id. Tests hold the two to the same answer.
 */
export const sealedSql = (memberColumn: string) =>
  `(EXISTS (SELECT 1 FROM social_accounts WHERE member_id = ${memberColumn} AND state = 'proven') AND EXISTS (SELECT 1 FROM claims WHERE member_id = ${memberColumn} AND state = 'ticked'))`;

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

/** A member as their words are signed on the Floor and in Problems. */
export interface Author {
  readonly memberId: number;
  readonly handle: string;
  readonly name: string;
  readonly track: Track;
  readonly sealed: boolean;
}

/** A member who has a profile, as an author. Track and seal come from their claims now. */
export function authorOf(db: Db, memberId: number): Author {
  const row = db.prepare('SELECT m.name, p.handle, p.creator FROM members m JOIN profiles p ON p.member_id = m.id WHERE m.id = ?').get(memberId);
  if (!row) throw new Error(`Member ${memberId} has no profile`);
  const facts = claimFacts(db, memberId);
  return { memberId, handle: text(row, 'handle'), name: text(row, 'name'), track: trackOf(facts, integer(row, 'creator') === 1), sealed: sealOf(facts) };
}

/** A member who has set a password and is not suspended, as SQL on a member id column. */
export const activeSql = (memberColumn: string) => `EXISTS (SELECT 1 FROM members WHERE id = ${memberColumn} AND ${STATUS_SQL.active})`;

/**
 * Credentials that name what someone is, most telling first: a qualifying body status, a training one, a licence, an
 * academic post. A workplace or experience does not read as "a ticked …", so a seal without these says "member".
 */
const CREDENTIAL_RANK = ['qualified', 'training', 'licence', 'academic'] as const;

/** The label of a member's most telling ticked credential, as their profile shows it, or "member". */
export function mainCredential(db: Db, memberId: number): string {
  const ranked = db
    .prepare(`SELECT kind, label, body_id, status_level FROM claims WHERE member_id = ? AND state = 'ticked' ORDER BY id`)
    .all(memberId)
    .map((row) => {
      const kind = text(row, 'kind');
      const bodyId = optionalText(row, 'body_id');
      const status = optionalText(row, 'status_level');
      const bucket = kind === 'body' ? ((bodyId && status ? statusTrack(bodyId, status) : null) ?? 'training') : kind;
      return { label: text(row, 'label'), rank: CREDENTIAL_RANK.findIndex((entry) => entry === bucket) };
    })
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank);
  return ranked[0]?.label ?? 'member';
}

/** What a new member has done of setting up their profile. The profile hides the checklist once all are done. */
export interface Checklist {
  readonly ticked: boolean;
  readonly headline: boolean;
  readonly casebook: boolean;
  readonly answered: boolean;
  readonly badge: boolean;
}

/** Sign-ups that never set a password are deleted after this long, and their handle is free again. */
export const ABANDONED_AFTER_DAYS = 14;

/** Malaysian time has no daylight saving. */
const MYT_OFFSET_MS = 8 * 3_600_000;

/** The moment the quarter that date falls in began, in Malaysia. Peer points count from here. */
export function quarterStart(date: Date): Date {
  const local = new Date(date.getTime() + MYT_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), Math.floor(local.getUTCMonth() / 3) * 3, 1) - MYT_OFFSET_MS);
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
  /**
   * Peer points this quarter: ratings of Sound on the member's answers, from raters who hold the seal now, and saves of
   * their shelf items. A changed rating counts from when it changed.
   */
  const peerPoints = (memberId: number): number =>
    count(
      db
        .prepare(
          `SELECT count(*) AS n FROM ratings rt JOIN answers a ON a.id = rt.answer_id
           WHERE a.member_id = ? AND rt.verdict = 'sound' AND rt.created_at >= ? AND ${activeSql('rt.rater_id')} AND ${sealedSql('rt.rater_id')}`,
        )
        .get(memberId, iso(quarterStart(now()))),
    ) +
    count(
      db
        .prepare(
          `SELECT count(*) AS n FROM saves s JOIN shelf_items i ON i.id = s.item_id
           WHERE i.member_id = ? AND i.removed_at IS NULL AND s.created_at >= ? AND ${activeSql('s.member_id')}`,
        )
        .get(memberId, iso(quarterStart(now()))),
    );

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

  /** Let in already, or accepted by the club, which lets them in without an invite. */
  const mayClaim = (memberId: number) => admitted(db, memberId) || db.prepare(`SELECT 1 FROM members WHERE id = ? AND ${CLUB_APPROVED_SQL}`).get(memberId) !== undefined;

  return {
    /**
     * A new member from the social site, let in by entry, with a handle. For callers that have already checked how they
     * got in: the invite and nomination modules spend their link in the same transaction instead. Nothing is saved
     * when anything is refused.
     */
    signUp(input: { name: string; email: string; handle: string }, entry: Entry): Result<{ memberId: number }, SignUpRefusal> {
      return attempt<{ memberId: number }, SignUpRefusal>(db, (refuse) => ({ memberId: openAccount(db, now(), input, entry, refuse) }));
    },

    /** True when the member may claim a handle: something let them in, or the club accepted them. */
    mayClaim,

    /**
     * A handle for a member who has none yet: a club member coming to the social site, or someone let in without one,
     * like an approved request. A club member is let in as they claim it.
     */
    claimHandle(memberId: number, handle: string): Result<Profile, ClaimRefusal> {
      return attempt<Profile, ClaimRefusal>(db, (refuse) => {
        if (ownProfile(memberId)) refuse('already-claimed');
        if (!mayClaim(memberId)) refuse('not-invited');
        admit(db, now(), memberId, { via: 'club' });
        insertProfile(db, now(), memberId, normaliseHandle(handle), refuse);
        const claimed = ownProfile(memberId);
        if (!claimed) throw new Error(`Profile for member ${memberId} was not saved`);
        return claimed;
      });
    },

    /** The member's own profile, whatever their status. Null before they claim a handle. */
    ownProfile,

    /** How the member got into Social. Null before anything let them in. */
    entry(memberId: number): { readonly via: EntryVia; readonly inviterId: number | null } | null {
      const row = db.prepare('SELECT joined_via, inviter_id FROM social_entries WHERE member_id = ?').get(memberId);
      if (!row) return null;
      const inviter = row['inviter_id'];
      return { via: oneOf(row, 'joined_via', ENTRY_VIA), inviterId: inviter === null || inviter === undefined ? null : integer(row, 'inviter_id') };
    },

    /** Who invited the member, when a member did and the inviter's profile is public. */
    invitedBy(memberId: number): { readonly handle: string; readonly name: string } | null {
      const row = db
        .prepare(
          `SELECT p.handle, m.name FROM social_entries e JOIN profiles p ON p.member_id = e.inviter_id JOIN members m ON m.id = e.inviter_id
           WHERE e.member_id = ? AND e.joined_via = 'member' AND ${activeSql('e.inviter_id')}`,
        )
        .get(memberId);
      return row ? { handle: text(row, 'handle'), name: text(row, 'name') } : null;
    },

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

    /**
     * Listed profiles where a word in the name, handle, headline or a topic starts with the query: five at most, the
     * longest here first. Unlisted profiles stay out of search, as they stay off The List.
     */
    search(query: string, limit = 5): Profile[] {
      const match = matcher(query);
      if (!match) return [];
      return db
        .prepare(
          `${PROFILES} WHERE p.listed = 1 AND ${PUBLIC}
           AND (m.name LIKE ? ESCAPE '\\' OR p.handle LIKE ? ESCAPE '\\' OR p.headline LIKE ? ESCAPE '\\' OR p.topics LIKE ? ESCAPE '\\')
           ORDER BY p.created_at, p.member_id LIMIT 200`,
        )
        .all(match.like, match.like, match.like, match.like)
        .filter((row) => [text(row, 'name'), text(row, 'handle'), text(row, 'headline'), ...listOf(row, 'topics', TOPICS)].some(match.test))
        .slice(0, limit)
        .map(toProfile);
    },

    /** Follows a public profile. Following twice changes nothing. */
    follow(followerId: number, handle: string): Result<Profile, FollowRefusal> {
      const followee = publicProfile(handle);
      if (!followee) return fail('not-found');
      if (followee.memberId === followerId) return fail('self');
      db.transaction(() => {
        db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(followerId, followee.memberId, iso(now()));
        notify(db, now(), followee.memberId, { kind: 'follow', key: String(followerId), actorId: followerId });
      });
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

    /** The member's setup checklist. */
    checklist(memberId: number): Checklist {
      const has = (sql: string) => db.prepare(sql).get(memberId) !== undefined;
      return {
        ticked: sealOf(claimFacts(db, memberId)),
        headline: has(`SELECT 1 FROM profiles WHERE member_id = ? AND headline != ''`),
        casebook: has('SELECT 1 FROM casebook WHERE member_id = ?'),
        answered: has('SELECT 1 FROM answers WHERE member_id = ?'),
        badge: has('SELECT 1 FROM profiles WHERE member_id = ? AND badge_copied_at IS NOT NULL'),
      };
    },

    /** The member copied their badge for a bio. The first copy is the one kept. */
    badgeCopied(memberId: number): void {
      db.prepare('UPDATE profiles SET badge_copied_at = coalesce(badge_copied_at, ?) WHERE member_id = ?').run(iso(now()), memberId);
    },

    /** A member's most telling ticked credential, for their badge. */
    credential(memberId: number): string {
      return mainCredential(db, memberId);
    },

    /**
     * Deletes members who signed up on the social site and never set a password, after ABANDONED_AFTER_DAYS. Their
     * profile and handle go with them. A nomination they claimed at sign-up goes back to the team's queue, so it can be
     * sent again, and a member's invite they used goes back to the member who sent it. Club members, members the club
     * accepted, members the team paused, and the team are never touched. Requests and unused invites are not members,
     * so nothing here reaches them. Returns how many went.
     */
    pruneAbandoned(): number {
      return db.transaction(() => {
        const cutoff = iso(new Date(now().getTime() - ABANDONED_AFTER_DAYS * 86_400_000));
        const abandoned = db
          .prepare(
            `SELECT id FROM members WHERE joined_via = 'social' AND role = 'member' AND ${STATUS_SQL.invited} AND club_approved_at IS NULL AND joined_at < ?`,
          )
          .all(cutoff)
          .map((row) => integer(row, 'id'));
        for (const memberId of abandoned) {
          db.prepare(
            `UPDATE nominations SET state = 'pending', invite_token_hash = NULL, decided_at = NULL, decided_by = NULL
             WHERE state = 'claimed' AND EXISTS (SELECT 1 FROM social_accounts a WHERE a.member_id = ? AND a.platform = nominations.platform AND a.handle = nominations.handle)`,
          ).run(memberId);
          db.prepare('DELETE FROM social_invites WHERE used_by = ?').run(memberId);
          db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
        }
        return abandoned.length;
      });
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
