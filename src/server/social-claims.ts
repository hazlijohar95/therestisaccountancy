import { createHash, randomBytes } from 'node:crypto';
import {
  BODY_IDS,
  bodyById,
  PERSONAL_EMAIL_DOMAINS,
  PLATFORM_PROFILES,
  PLATFORMS,
  RENEWAL_REMINDER_DAYS,
  statusTrack,
  VOUCHES_TO_TICK,
  type BodyId,
  type Licence,
  type Platform,
} from '../data/social.ts';
import { STATUS_SQL } from './club.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import type { Result } from './result.ts';
import { claimFacts, sealOf } from './social-profiles.ts';

/*
 * Ticks: social accounts a member proves, and claims about their credentials. The team checks accounts, bodies,
 * licences and academic posts by hand; a work email checks itself by a link; experience is the member's word until
 * three sealed peers vouch for it. Rows are never edited after they are sent: a member who wants to change one removes
 * it and adds it again, which gives it a new id. Ids are AUTOINCREMENT, so a removed id is never reused, and a
 * reviewer's decision on an id is a decision on exactly what they read.
 */

export const CLAIM_KINDS = ['body', 'licence', 'employer', 'academic', 'experience'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_SOURCES = ['register', 'document', 'email', 'vouch', 'self'] as const;
export type ClaimSource = (typeof CLAIM_SOURCES)[number];

const CLAIM_STATES = ['pending', 'ticked', 'rejected', 'lapsed'] as const;
const ACCOUNT_STATES = ['pending', 'proven', 'rejected'] as const;

/** Who ticks each kind. Only the kinds the team checks reach the review queue. */
export const CHECKED_BY = {
  body: 'team',
  licence: 'team',
  academic: 'team',
  employer: 'email',
  experience: 'peers',
} as const satisfies Record<ClaimKind, 'team' | 'email' | 'peers'>;
const TEAM_KINDS = CLAIM_KINDS.filter((kind) => CHECKED_BY[kind] === 'team');

export type ClaimReview =
  | { readonly state: 'pending' }
  | { readonly state: 'ticked'; readonly at: string }
  | { readonly state: 'lapsed'; readonly at: string }
  | { readonly state: 'rejected'; readonly at: string; readonly reason: string };

export interface Claim {
  readonly id: number;
  readonly memberId: number;
  readonly kind: ClaimKind;
  readonly bodyId: BodyId | null;
  /** What the profile shows: "ACCA · Member", "Licensed tax agent", "Works at firm.com.my". */
  readonly label: string;
  /** The exact status a body claim is at. Null for other kinds. */
  readonly status: string | null;
  /** What the team checks against: a member or licence number, or a staff page. Never shown in public. */
  readonly reference: string | null;
  readonly source: ClaimSource;
  readonly review: ClaimReview;
  /** The month the tick runs to, as YYYY-MM. It lapses when that month ends, in Malaysian time. */
  readonly until: string | null;
  /** A document waits for the team. Gone once the claim is decided. */
  readonly hasEvidence: boolean;
  readonly vouches: number;
  readonly createdAt: string;
}

/** A claim as anyone may see it on a profile. */
export interface LedgerClaim extends Omit<Claim, 'reference' | 'hasEvidence' | 'review'> {
  readonly review: Exclude<ClaimReview, { state: 'rejected' }>;
  /** The viewer has vouched for it. False for anyone signed out. */
  readonly vouchedByViewer: boolean;
}

export type AccountReview =
  | { readonly state: 'pending' }
  | { readonly state: 'proven'; readonly at: string }
  | { readonly state: 'rejected'; readonly at: string; readonly reason: string };

export interface Account {
  readonly id: number;
  readonly memberId: number;
  readonly platform: Platform;
  readonly handle: string;
  /** Goes in the account's bio until the team has seen it there. */
  readonly code: string;
  /** The profile's address on the platform. */
  readonly url: string;
  readonly review: AccountReview;
  readonly createdAt: string;
}

/** What a member sends. Employer claims start from a work email instead. */
export type ClaimDraft =
  | {
      readonly kind: 'body';
      readonly bodyId: BodyId;
      readonly status: string;
      readonly reference: string;
      /** For 'other' only: the body's name, and the certificate that shows it. */
      readonly otherName: string | null;
      readonly evidenceKey: string | null;
    }
  | { readonly kind: 'licence'; readonly licence: Licence; readonly reference: string; readonly until: string; readonly evidenceKey: string }
  | { readonly kind: 'academic'; readonly role: string; readonly url: string }
  | { readonly kind: 'experience'; readonly text: string };

export interface Person {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly handle: string | null;
}

export interface Queued<T> {
  readonly item: T;
  readonly member: Person;
}

export interface ReviewQueue {
  readonly accounts: readonly Queued<Account>[];
  /** Bodies with a public register, and academic posts: checked against a public record. */
  readonly credentials: readonly Queued<Claim>[];
  /** Claims that came with a document. */
  readonly documents: readonly Queued<Claim>[];
}

export type Verdict = { readonly verdict: 'approve' } | { readonly verdict: 'reject'; readonly reason: string };

export type AccountRefusal = 'handle-invalid' | 'platform-taken' | 'proven-elsewhere';
export type ClaimRefusal = 'duplicate' | 'too-many';
export type WorkEmailRefusal = 'address-invalid' | 'personal-domain' | 'already-ticked' | 'too-soon' | 'too-many';
export type ConfirmRefusal = 'not-found' | 'not-yours';
export type VouchRefusal = 'not-found' | 'self' | 'no-seal' | 'already';
export type DecisionRefusal = 'not-found' | 'already' | 'proven-elsewhere';

export interface WorkEmailCheck {
  readonly claim: Claim;
  /** Shown once, in the emailed link. Only its hash is stored. */
  readonly token: string;
  readonly address: string;
  readonly expiresAt: string;
}

/** A live work-email link, as the page it opens shows it. */
export interface PendingWorkEmail {
  readonly claimId: number;
  readonly memberId: number;
  readonly name: string;
  readonly handle: string | null;
  readonly domain: string;
}

export interface Renewal {
  readonly claim: Claim;
  readonly member: Person;
  readonly daysLeft: number;
}

const DAY_MS = 86_400_000;
/** Malaysian time has no daylight saving, so a month there ends at a fixed offset from UTC. */
const MYT_OFFSET_MS = 8 * 3_600_000;
const WORK_EMAIL_DAYS = 7;
/** One work-email link per claim in this window, so the form cannot flood someone else's inbox. */
const WORK_EMAIL_GAP_MS = 10 * 60_000;
/** Claims a member can have waiting at once. */
const MAX_PENDING = 20;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** TRIA- and six characters nobody confuses for each other. Random, so nobody can post it before they are given it. */
const newCode = () => `TRIA-${[...randomBytes(6)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')}`;

/** The moment a tick that runs to this month lapses: the start of the next month in Malaysia. */
export function lapsesAt(until: string): Date {
  const [year, month] = until.split('-').map(Number);
  if (!year || !month) throw new TypeError(`${until} is not a month`);
  return new Date(Date.UTC(year, month, 1) - MYT_OFFSET_MS);
}

/** Whole days left before a tick lapses, rounded up: 1 on its last day, 0 or less once it has lapsed. */
export const daysLeft = (until: string, now: Date) => Math.ceil((lapsesAt(until).getTime() - now.getTime()) / DAY_MS);

/** The month a date falls in, in Malaysia, as YYYY-MM, moved on by some months. */
export function monthOf(date: Date, plusMonths = 0): string {
  const local = new Date(date.getTime() + MYT_OFFSET_MS);
  const moved = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + plusMonths, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The files the team accepts as evidence, by what the file's first bytes say it is, never by its name or claimed type. */
export const EVIDENCE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) => prefix.every((byte, i) => bytes[at + i] === byte);

/** What a file is, from its first bytes. Null for anything else, an SVG or HTML page dressed as an image included. */
export function evidenceType(head: Uint8Array): EvidenceType | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** The domain of a work address, lowercased. Null when the address has none. */
export function emailDomain(address: string): string | null {
  const at = address.lastIndexOf('@');
  const domain = at > 0 ? address.slice(at + 1).trim().toLowerCase() : '';
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain) ? domain : null;
}

/** An address anyone can open, so a link sent there proves nothing about an employer. Subdomains count. */
export const isPersonalDomain = (domain: string) => [...PERSONAL_EMAIL_DOMAINS].some((personal) => domain === personal || domain.endsWith(`.${personal}`));

const accountReview = (row: Row): AccountReview => {
  const state = oneOf(row, 'state', ACCOUNT_STATES);
  if (state === 'pending') return { state };
  const at = text(row, 'decided_at');
  return state === 'proven' ? { state, at } : { state, at, reason: optionalText(row, 'note') ?? '' };
};

const toAccount = (row: Row): Account => {
  const platform = oneOf(row, 'platform', PLATFORMS);
  const handle = text(row, 'handle');
  return {
    id: integer(row, 'id'),
    memberId: integer(row, 'member_id'),
    platform,
    handle,
    code: text(row, 'code'),
    url: PLATFORM_PROFILES[platform].url(handle),
    review: accountReview(row),
    createdAt: text(row, 'created_at'),
  };
};

const claimReview = (row: Row): ClaimReview => {
  const state = oneOf(row, 'state', CLAIM_STATES);
  if (state === 'pending') return { state };
  const at = text(row, 'decided_at');
  return state === 'rejected' ? { state, at, reason: optionalText(row, 'note') ?? '' } : { state, at };
};

/** Claim rows come with their vouch count. */
const CLAIMS = 'SELECT c.*, (SELECT count(*) FROM vouches v WHERE v.claim_id = c.id) AS vouches FROM claims c';

const toClaim = (row: Row): Claim => ({
  id: integer(row, 'id'),
  memberId: integer(row, 'member_id'),
  kind: oneOf(row, 'kind', CLAIM_KINDS),
  bodyId: optionalText(row, 'body_id') === null ? null : oneOf(row, 'body_id', BODY_IDS),
  label: text(row, 'label'),
  status: optionalText(row, 'status_level'),
  reference: optionalText(row, 'reference'),
  source: oneOf(row, 'source', CLAIM_SOURCES),
  review: claimReview(row),
  until: optionalText(row, 'until'),
  hasEvidence: optionalText(row, 'evidence_key') !== null,
  vouches: integer(row, 'vouches'),
  createdAt: text(row, 'created_at'),
});

const PEOPLE = 'SELECT m.id, m.name, m.email, p.handle FROM members m LEFT JOIN profiles p ON p.member_id = m.id';

const toPerson = (row: Row): Person => ({ id: integer(row, 'id'), name: text(row, 'name'), email: text(row, 'email'), handle: optionalText(row, 'handle') });

/** Two claims are the same credential, so a newer tick replaces an older one: the same body, or the same label. */
const sameCredential = (a: Claim, b: Claim) =>
  a.kind === b.kind && (a.kind === 'body' && a.bodyId !== 'other' ? a.bodyId === b.bodyId : a.label === b.label);

/** Social accounts, claims, work-email checks, vouches, the team's review queue, and lapsing. */
export function createSocialClaims(db: Db, now: () => Date = () => new Date()) {
  const account = (id: number): Account | null => {
    const row = db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(id);
    return row ? toAccount(row) : null;
  };
  const claim = (id: number): Claim | null => {
    const row = db.prepare(`${CLAIMS} WHERE c.id = ?`).get(id);
    return row ? toClaim(row) : null;
  };
  const person = (memberId: number): Person => {
    const row = db.prepare(`${PEOPLE} WHERE m.id = ?`).get(memberId);
    if (!row) throw new Error(`Member ${memberId} does not exist`);
    return toPerson(row);
  };
  const saved = (id: number): Claim => {
    const found = claim(id);
    if (!found) throw new Error(`Claim ${id} was not saved`);
    return found;
  };
  const pendingCount = (memberId: number) => count(db.prepare(`SELECT count(*) AS n FROM claims WHERE member_id = ? AND state = 'pending'`).get(memberId));

  const insertClaim = (
    memberId: number,
    fields: { kind: ClaimKind; bodyId?: BodyId; label: string; status?: string; reference?: string; source: ClaimSource; until?: string; evidenceKey?: string | null },
  ) =>
    db
      .prepare(
        `INSERT INTO claims (member_id, kind, body_id, label, status_level, reference, source, until, evidence_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memberId,
        fields.kind,
        fields.bodyId ?? null,
        fields.label,
        fields.status ?? null,
        fields.reference ?? null,
        fields.source,
        fields.until ?? null,
        fields.evidenceKey ?? null,
        iso(now()),
      ).lastInsertRowid;

  const workEmail = (token: string): PendingWorkEmail | null => {
    const row = db
      .prepare(
        `SELECT c.id AS claim_id, c.member_id, c.label, m.name, p.handle FROM email_checks e
         JOIN claims c ON c.id = e.claim_id JOIN members m ON m.id = c.member_id LEFT JOIN profiles p ON p.member_id = m.id
         WHERE e.token_hash = ? AND e.used_at IS NULL AND e.expires_at > ? AND c.state = 'pending'`,
      )
      .get(tokenHash(token), iso(now()));
    if (!row) return null;
    return {
      claimId: integer(row, 'claim_id'),
      memberId: integer(row, 'member_id'),
      name: text(row, 'name'),
      handle: optionalText(row, 'handle'),
      domain: text(row, 'label').replace(/^Works at /, ''),
    };
  };

  /** A new tick replaces the member's older ticked or lapsed claim to the same credential: that is how renewing works. */
  const tick = (ticked: Claim, reviewerId: number | null, fields: { source?: ClaimSource; until?: string | null } = {}) => {
    db.prepare(`UPDATE claims SET state = 'ticked', decided_at = ?, decided_by = ?, source = coalesce(?, source), until = ? WHERE id = ?`).run(
      iso(now()),
      reviewerId,
      fields.source ?? null,
      fields.until === undefined ? ticked.until : fields.until,
      ticked.id,
    );
    const older = db
      .prepare(`${CLAIMS} WHERE c.member_id = ? AND c.kind = ? AND c.state IN ('ticked', 'lapsed') AND c.id != ?`)
      .all(ticked.memberId, ticked.kind, ticked.id)
      .map(toClaim)
      .filter((other) => sameCredential(other, ticked));
    for (const other of older) db.prepare('DELETE FROM claims WHERE id = ?').run(other.id);
  };

  return {
    /** Everything a member has sent, in every state, newest first. Only they and the team see this. */
    mine(memberId: number): { readonly accounts: Account[]; readonly claims: Claim[] } {
      return {
        accounts: db.prepare('SELECT * FROM social_accounts WHERE member_id = ? ORDER BY id DESC').all(memberId).map(toAccount),
        claims: db.prepare(`${CLAIMS} WHERE c.member_id = ? ORDER BY c.id DESC`).all(memberId).map(toClaim),
      };
    },

    /**
     * What a profile shows: ticked and lapsed claims, experience waiting for vouches, and proven accounts. Pending
     * checks, rejections and the references the team checked against stay private.
     */
    ledger(memberId: number, viewerId: number | null): { readonly claims: LedgerClaim[]; readonly accounts: Account[] } {
      const rows = db
        .prepare(`${CLAIMS} WHERE c.member_id = ? AND (c.state IN ('ticked', 'lapsed') OR (c.kind = 'experience' AND c.state = 'pending')) ORDER BY c.id`)
        .all(memberId);
      const vouched = new Set(
        viewerId === null
          ? []
          : db
              .prepare(`SELECT v.claim_id FROM vouches v JOIN claims c ON c.id = v.claim_id WHERE c.member_id = ? AND v.voucher_id = ?`)
              .all(memberId, viewerId)
              .map((row) => integer(row, 'claim_id')),
      );
      const claims = rows.map(toClaim).flatMap(({ reference: _reference, hasEvidence: _evidence, review, ...rest }): LedgerClaim[] =>
        review.state === 'rejected' ? [] : [{ ...rest, review, vouchedByViewer: vouched.has(rest.id) }],
      );
      const accounts = db.prepare(`SELECT * FROM social_accounts WHERE member_id = ? AND state = 'proven' ORDER BY id`).all(memberId).map(toAccount);
      return { claims, accounts };
    },

    /** Adds an account with a fresh code for its bio. One live account per platform; a proven account has one owner. */
    addAccount(memberId: number, platform: Platform, handle: string): Result<Account, AccountRefusal> {
      return attempt<Account, AccountRefusal>(db, (refuse) => {
        if (!PLATFORM_PROFILES[platform].pattern.test(handle)) refuse('handle-invalid');
        if (db.prepare(`SELECT 1 FROM social_accounts WHERE member_id = ? AND platform = ? AND state != 'rejected'`).get(memberId, platform)) refuse('platform-taken');
        if (db.prepare(`SELECT 1 FROM social_accounts WHERE platform = ? AND handle = ? AND state = 'proven' AND member_id != ?`).get(platform, handle, memberId)) {
          refuse('proven-elsewhere');
        }
        const { lastInsertRowid } = db
          .prepare('INSERT INTO social_accounts (member_id, platform, handle, code, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(memberId, platform, handle, newCode(), iso(now()));
        return account(lastInsertRowid) ?? refuse('handle-invalid');
      });
    },

    /** True when the member had that account to remove. Removing a proven account can take the seal with it. */
    removeAccount(memberId: number, accountId: number): boolean {
      return db.prepare('DELETE FROM social_accounts WHERE id = ? AND member_id = ?').run(accountId, memberId).changes > 0;
    },

    /** Sends a claim to whoever checks its kind. The same claim waiting twice is refused. */
    addClaim(memberId: number, draft: ClaimDraft): Result<Claim, ClaimRefusal> {
      return attempt<Claim, ClaimRefusal>(db, (refuse) => {
        const fields = (() => {
          switch (draft.kind) {
            case 'body': {
              const body = bodyById(draft.bodyId);
              if (!body || statusTrack(draft.bodyId, draft.status) === null) throw new TypeError(`${draft.bodyId} has no status ${draft.status}`);
              const other = body.id === 'other';
              if (other !== (draft.evidenceKey !== null && draft.otherName !== null)) throw new TypeError('Another body needs its name and a document; a listed body takes neither');
              return {
                kind: draft.kind,
                bodyId: body.id,
                label: `${other ? draft.otherName : body.name} · ${draft.status}`,
                status: draft.status,
                reference: draft.reference,
                source: other ? ('document' as const) : ('register' as const),
                evidenceKey: draft.evidenceKey,
              };
            }
            case 'licence':
              return { kind: draft.kind, label: draft.licence, reference: draft.reference, source: 'document' as const, until: draft.until, evidenceKey: draft.evidenceKey };
            case 'academic':
              return { kind: draft.kind, label: draft.role, reference: draft.url, source: 'register' as const };
            case 'experience':
              return { kind: draft.kind, label: draft.text, source: 'self' as const };
          }
        })();
        if (db.prepare(`SELECT 1 FROM claims WHERE member_id = ? AND kind = ? AND label = ? AND state = 'pending'`).get(memberId, fields.kind, fields.label)) refuse('duplicate');
        if (pendingCount(memberId) >= MAX_PENDING) refuse('too-many');
        return saved(insertClaim(memberId, fields));
      });
    },

    /** Removes one of the member's claims. The caller deletes its document, if it still had one. */
    removeClaim(memberId: number, claimId: number): { readonly removed: boolean; readonly evidenceKey: string | null } {
      return db.transaction(() => {
        const row = db.prepare('SELECT evidence_key FROM claims WHERE id = ? AND member_id = ?').get(claimId, memberId);
        if (!row) return { removed: false, evidenceKey: null };
        db.prepare('DELETE FROM claims WHERE id = ?').run(claimId);
        return { removed: true, evidenceKey: optionalText(row, 'evidence_key') };
      });
    },

    /**
     * Starts a work-email check: the employer claim for the address's domain, and a one-time link for the caller to
     * send there. Asking again for the same domain sends a new link and retires the old one.
     */
    startWorkEmail(memberId: number, address: string): Result<WorkEmailCheck, WorkEmailRefusal> {
      return attempt<WorkEmailCheck, WorkEmailRefusal>(db, (refuse) => {
        const domain = emailDomain(address) ?? refuse('address-invalid');
        if (isPersonalDomain(domain)) refuse('personal-domain');
        const label = `Works at ${domain}`;
        const existing = db.prepare(`${CLAIMS} WHERE c.member_id = ? AND c.kind = 'employer' AND c.label = ? AND c.state IN ('pending', 'ticked')`).get(memberId, label);
        const current = existing ? toClaim(existing) : null;
        if (current?.review.state === 'ticked') refuse('already-ticked');
        const since = iso(new Date(now().getTime() - WORK_EMAIL_GAP_MS));
        if (current && db.prepare('SELECT 1 FROM email_checks WHERE claim_id = ? AND created_at > ?').get(current.id, since)) refuse('too-soon');
        if (!current && pendingCount(memberId) >= MAX_PENDING) refuse('too-many');
        const claimId = current?.id ?? insertClaim(memberId, { kind: 'employer', label, source: 'email' });
        db.prepare('UPDATE email_checks SET used_at = ? WHERE claim_id = ? AND used_at IS NULL').run(iso(now()), claimId);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = iso(new Date(now().getTime() + WORK_EMAIL_DAYS * DAY_MS));
        db.prepare('INSERT INTO email_checks (token_hash, claim_id, address, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
          tokenHash(token),
          claimId,
          address,
          iso(now()),
          expiresAt,
        );
        return { claim: saved(claimId), token, address, expiresAt };
      });
    },

    /** What a work-email link is for, while it still works. Null when it is unknown, used or out of date. */
    workEmail,

    /**
     * Ticks the employer claim behind a live link. Only the member who asked for it can: a link a mail scanner opens,
     * or one sent to someone else's address, confirms nothing by itself.
     */
    confirmWorkEmail(memberId: number, token: string): Result<Claim, ConfirmRefusal> {
      return attempt<Claim, ConfirmRefusal>(db, (refuse) => {
        const pending = workEmail(token) ?? refuse('not-found');
        if (pending.memberId !== memberId) refuse('not-yours');
        db.prepare('UPDATE email_checks SET used_at = ? WHERE claim_id = ? AND used_at IS NULL').run(iso(now()), pending.claimId);
        tick(saved(pending.claimId), null);
        return saved(pending.claimId);
      });
    },

    /**
     * A sealed member vouches for someone else's experience, once. The third vouch ticks it. Vouches keep counting
     * after that, and show beside the tick.
     */
    vouch(voucherId: number, claimId: number): Result<Claim, VouchRefusal> {
      return attempt<Claim, VouchRefusal>(db, (refuse) => {
        const row = db
          .prepare(`${CLAIMS} JOIN members m ON m.id = c.member_id WHERE c.id = ? AND c.kind = 'experience' AND c.state IN ('pending', 'ticked') AND ${STATUS_SQL.active}`)
          .get(claimId);
        const target = row ? toClaim(row) : refuse('not-found');
        if (target.memberId === voucherId) refuse('self');
        if (!sealOf(claimFacts(db, voucherId))) refuse('no-seal');
        if (db.prepare('INSERT INTO vouches (claim_id, voucher_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(claimId, voucherId, iso(now())).changes === 0) {
          refuse('already');
        }
        const after = saved(claimId);
        if (after.review.state === 'pending' && after.vouches >= VOUCHES_TO_TICK) tick(after, null, { source: 'vouch' });
        return saved(claimId);
      });
    },

    /** Everything waiting for the team, oldest first. */
    queue(): ReviewQueue {
      const people = new Map<number, Person>();
      const who = (memberId: number) => {
        const known = people.get(memberId) ?? person(memberId);
        people.set(memberId, known);
        return known;
      };
      const accounts = db.prepare(`SELECT * FROM social_accounts WHERE state = 'pending' ORDER BY id`).all().map(toAccount);
      const claims = db
        .prepare(`${CLAIMS} WHERE c.state = 'pending' AND c.kind IN (${TEAM_KINDS.map(() => '?').join(', ')}) ORDER BY c.id`)
        .all(...TEAM_KINDS)
        .map(toClaim);
      return {
        accounts: accounts.map((item) => ({ item, member: who(item.memberId) })),
        credentials: claims.filter((c) => !c.hasEvidence).map((item) => ({ item, member: who(item.memberId) })),
        documents: claims.filter((c) => c.hasEvidence).map((item) => ({ item, member: who(item.memberId) })),
      };
    },

    /** The team's decision on the account they looked at. A second decision is refused, so the member hears once. */
    decideAccount(accountId: number, reviewerId: number, verdict: Verdict): Result<Queued<Account>, DecisionRefusal> {
      return attempt<Queued<Account>, DecisionRefusal>(db, (refuse) => {
        const current = account(accountId) ?? refuse('not-found');
        if (current.review.state !== 'pending') refuse('already');
        if (verdict.verdict === 'approve') {
          const owned = db.prepare(`SELECT 1 FROM social_accounts WHERE platform = ? AND handle = ? AND state = 'proven'`).get(current.platform, current.handle);
          if (owned) refuse('proven-elsewhere');
        }
        db.prepare('UPDATE social_accounts SET state = ?, note = ?, decided_at = ?, decided_by = ? WHERE id = ?').run(
          verdict.verdict === 'approve' ? 'proven' : 'rejected',
          verdict.verdict === 'reject' ? verdict.reason : null,
          iso(now()),
          reviewerId,
          accountId,
        );
        return { item: account(accountId) ?? refuse('not-found'), member: person(current.memberId) };
      });
    },

    /**
     * The team's decision on a claim they checked. A body tick runs a year from now; a licence runs to the month the
     * member gave. The document is kept until the caller has deleted it and called evidenceDeleted.
     */
    decideClaim(claimId: number, reviewerId: number, verdict: Verdict): Result<Queued<Claim>, DecisionRefusal> {
      return attempt<Queued<Claim>, DecisionRefusal>(db, (refuse) => {
        const current = claim(claimId) ?? refuse('not-found');
        if (CHECKED_BY[current.kind] !== 'team') refuse('not-found');
        if (current.review.state !== 'pending') refuse('already');
        if (verdict.verdict === 'approve') {
          tick(current, reviewerId, { until: current.kind === 'body' ? monthOf(now(), 12) : current.until });
        } else {
          db.prepare(`UPDATE claims SET state = 'rejected', note = ?, decided_at = ?, decided_by = ? WHERE id = ?`).run(verdict.reason, iso(now()), reviewerId, claimId);
        }
        return { item: saved(claimId), member: person(current.memberId) };
      });
    },

    /** The stored document of a claim still waiting for the team, for the team to read. */
    evidenceKey(claimId: number): string | null {
      const row = db.prepare(`SELECT evidence_key FROM claims WHERE id = ? AND state = 'pending'`).get(claimId);
      return row ? optionalText(row, 'evidence_key') : null;
    },

    /** Documents of decided claims that have not been deleted yet. The caller deletes each, then calls evidenceDeleted. */
    staleEvidence(): { readonly claimId: number; readonly key: string }[] {
      return db
        .prepare(`SELECT id, evidence_key FROM claims WHERE evidence_key IS NOT NULL AND state != 'pending'`)
        .all()
        .map((row) => ({ claimId: integer(row, 'id'), key: text(row, 'evidence_key') }));
    },

    evidenceDeleted(claimId: number): void {
      db.prepare(`UPDATE claims SET evidence_key = NULL WHERE id = ? AND state != 'pending'`).run(claimId);
    },

    /** Marks ticks whose month has ended as lapsed. Returns how many lapsed. Safe to rerun. */
    lapse(): number {
      return db.transaction(() => {
        const due = db
          .prepare(`SELECT id, until FROM claims WHERE state = 'ticked' AND until IS NOT NULL`)
          .all()
          .filter((row) => lapsesAt(text(row, 'until')).getTime() <= now().getTime());
        for (const row of due) db.prepare(`UPDATE claims SET state = 'lapsed' WHERE id = ?`).run(integer(row, 'id'));
        return due.length;
      });
    },

    /**
     * Ticks to remind their members about: 60 days before they lapse, then 14. Each reminder is marked as it is
     * returned, so it goes once. A tick first seen inside 14 days gets only the nearer one.
     */
    dueRenewals(): Renewal[] {
      return db.transaction(() => {
        const at = now();
        return db
          .prepare(`${CLAIMS} WHERE c.state = 'ticked' AND c.until IS NOT NULL ORDER BY c.id`)
          .all()
          .flatMap((row): Renewal[] => {
            const ticked = toClaim(row);
            const left = daysLeft(ticked.until ?? '', at);
            const stage = RENEWAL_REMINDER_DAYS.reduce((reached, days, i) => (left <= days ? i + 1 : reached), 0);
            if (left <= 0 || stage <= integer(row, 'reminded')) return [];
            db.prepare('UPDATE claims SET reminded = ? WHERE id = ?').run(stage, ticked.id);
            return [{ claim: ticked, member: person(ticked.memberId), daysLeft: left }];
          });
      });
    },
  };
}

export type SocialClaims = ReturnType<typeof createSocialClaims>;
