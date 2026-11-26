import { createHash, randomBytes } from 'node:crypto';
import { PLATFORM_PROFILES, PLATFORMS, TOPICS, type Platform, type Topic } from '../data/social.ts';
import { STATUS_SQL } from './club.ts';
import { attempt, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import type { Result } from './result.ts';
import { insertAccount, type AccountRefusal } from './social-claims.ts';
import { notify } from './social-notify.ts';
import { hasHandle, openAccount, type SignUpRefusal } from './social-profiles.ts';

/*
 * Nominations: a member names someone on a platform who should be on The List. Only a handle is known, never an email,
 * so the team sends the invite link themselves by direct message. Nothing about a nominee is public until they claim:
 * a nominator sees their own nominations, the team sees the queue, and the nominee sees their invite. One row per
 * platform and handle, ever. A nominee who says no keeps their row as 'removed', with every nominator deleted, so the
 * handle is never invited again and nothing else about them is kept.
 */

const STATES = ['pending', 'invited', 'claimed', 'removed', 'rejected'] as const;

export interface NominationDraft {
  readonly platform: Platform;
  /** As accountHandle() reads it: bare and lowercased. */
  readonly handle: string;
  readonly topics: readonly Topic[];
  /** One post that convinced the nominator. */
  readonly whyUrl: string | null;
}

/** A nomination as the member who made it sees it on The List. Only they see it. */
export interface OwnNomination {
  readonly id: number;
  readonly platform: Platform;
  readonly handle: string;
  readonly topics: readonly Topic[];
  readonly state: 'pending' | 'invited';
}

/** A nomination waiting for the team: to invite, or invited and waiting for the nominee. */
export interface QueuedNomination {
  readonly id: number;
  readonly platform: Platform;
  readonly handle: string;
  /** The nominee's profile on the platform, for the team to look at and to message. */
  readonly url: string;
  readonly nominators: number;
  readonly topics: readonly Topic[];
  /** The posts nominators gave, oldest first. */
  readonly links: readonly string[];
  readonly createdAt: string;
  readonly invitedAt: string | null;
}

/** What an invite says to the person it is for. */
export interface Invitation {
  readonly platform: Platform;
  readonly handle: string;
  readonly nominators: number;
  readonly topics: readonly Topic[];
}

export type NominateOutcome = 'nominated' | 'counted' | 'already';
/** 'on-list': a member has proven that account. 'closed': the nominee claimed, declined, or the team said no. */
export type NominateRefusal = 'handle-invalid' | 'on-list' | 'closed';
export type InviteRefusal = 'not-found' | 'already';
/** Claiming adds the account for proof, so its refusals come back too. 'not-found': the link is used, replaced or withdrawn. */
export type ClaimRefusal = AccountRefusal | 'not-found';
export type JoinRefusal = SignUpRefusal | ClaimRefusal;

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

const topicsOf = (rows: readonly Row[]): Topic[] => {
  const chosen = new Set(rows.flatMap((row): unknown[] => {
    const stored: unknown = JSON.parse(text(row, 'topics'));
    return Array.isArray(stored) ? stored : [];
  }));
  return TOPICS.filter((topic) => chosen.has(topic));
};

export function createSocialNominations(db: Db, now: () => Date = () => new Date()) {
  const nominatorRows = (nominationId: number) => db.prepare('SELECT topics, why_url FROM nominators WHERE nomination_id = ? ORDER BY created_at, member_id').all(nominationId);

  /** The public profile that has proven this account, if any. */
  const onList = (platform: Platform, handle: string): string | null => {
    const row = db
      .prepare(
        `SELECT p.handle FROM social_accounts a JOIN profiles p ON p.member_id = a.member_id
         WHERE a.platform = ? AND a.handle = ? AND a.state = 'proven' AND EXISTS (SELECT 1 FROM members WHERE id = a.member_id AND ${STATUS_SQL.active})`,
      )
      .get(platform, handle);
    return row ? text(row, 'handle') : null;
  };

  const toQueued = (row: Row): QueuedNomination => {
    const id = integer(row, 'id');
    const platform = oneOf(row, 'platform', PLATFORMS);
    const handle = text(row, 'handle');
    const nominators = nominatorRows(id);
    return {
      id,
      platform,
      handle,
      url: PLATFORM_PROFILES[platform].url(handle),
      nominators: nominators.length,
      topics: topicsOf(nominators),
      links: nominators.flatMap((n) => optionalText(n, 'why_url') ?? []),
      createdAt: text(row, 'created_at'),
      invitedAt: optionalText(row, 'decided_at'),
    };
  };

  const invited = (token: string): Row | undefined => db.prepare(`SELECT * FROM nominations WHERE invite_token_hash = ? AND state = 'invited'`).get(tokenHash(token));

  /**
   * Inside a transaction: the nominee's account goes to Get ticked for proof, the invite is spent, and every nominator
   * hears they joined. Refused, nothing is kept and the link still works.
   */
  const claimFor = (memberId: number, row: Row, refuse: (reason: ClaimRefusal) => never): Platform => {
    const id = integer(row, 'id');
    const platform = oneOf(row, 'platform', PLATFORMS);
    const handle = text(row, 'handle');
    insertAccount(db, now(), memberId, platform, handle, refuse);
    db.prepare(`UPDATE nominations SET state = 'claimed', invite_token_hash = NULL WHERE id = ?`).run(id);
    for (const nominator of db.prepare('SELECT member_id FROM nominators WHERE nomination_id = ?').all(id)) {
      notify(db, now(), integer(nominator, 'member_id'), { kind: 'nominee-joined', key: String(id), detail: `${platform} · @${handle}` });
    }
    return platform;
  };

  /** A fresh link for an invited nomination. The old one stops working. */
  const issueLink = (id: number, reviewerId: number) => {
    const token = randomBytes(24).toString('base64url');
    db.prepare(`UPDATE nominations SET state = 'invited', invite_token_hash = ?, decided_at = ?, decided_by = ? WHERE id = ?`).run(tokenHash(token), iso(now()), reviewerId, id);
    return token;
  };

  /** The team's change to a nomination in one of the given states. */
  const decide = <T>(id: number, from: readonly (typeof STATES)[number][], change: (row: Row) => T): Result<T, InviteRefusal> =>
    attempt<T, InviteRefusal>(db, (refuse) => {
      const row = db.prepare('SELECT * FROM nominations WHERE id = ?').get(id) ?? refuse('not-found');
      const state = oneOf(row, 'state', STATES);
      if (!from.includes(state)) refuse(state === 'pending' || state === 'invited' ? 'already' : 'not-found');
      return change(row);
    });

  return {
    onList,

    /**
     * Nominates a handle, or counts the member as one more nominator of a nomination that is already open. A member
     * counts once. A handle a member has proven is on The List already; a closed one is refused without saying why.
     */
    nominate(memberId: number, draft: NominationDraft): Result<{ readonly outcome: NominateOutcome }, NominateRefusal> {
      return attempt<{ readonly outcome: NominateOutcome }, NominateRefusal>(db, (refuse) => {
        if (!PLATFORM_PROFILES[draft.platform].pattern.test(draft.handle)) refuse('handle-invalid');
        if (onList(draft.platform, draft.handle)) refuse('on-list');
        const existing = db.prepare('SELECT id, state FROM nominations WHERE platform = ? AND handle = ?').get(draft.platform, draft.handle);
        if (existing && !['pending', 'invited'].includes(oneOf(existing, 'state', STATES))) refuse('closed');
        const id = existing
          ? integer(existing, 'id')
          : db.prepare('INSERT INTO nominations (platform, handle, created_at) VALUES (?, ?, ?)').run(draft.platform, draft.handle, iso(now())).lastInsertRowid;
        const added = db
          .prepare('INSERT INTO nominators (nomination_id, member_id, topics, why_url, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
          .run(id, memberId, JSON.stringify(TOPICS.filter((t) => draft.topics.includes(t))), draft.whyUrl, iso(now())).changes;
        return { outcome: !existing ? 'nominated' : added ? 'counted' : 'already' };
      });
    },

    /** The member's own open nominations, newest first, leaving out anyone who has since proven the account. */
    mine(memberId: number): OwnNomination[] {
      return db
        .prepare(
          `SELECT n.id, n.platform, n.handle, n.state, o.topics FROM nominators o JOIN nominations n ON n.id = o.nomination_id
           WHERE o.member_id = ? AND n.state IN ('pending', 'invited') ORDER BY o.created_at DESC, n.id DESC`,
        )
        .all(memberId)
        .flatMap((row): OwnNomination[] => {
          const platform = oneOf(row, 'platform', PLATFORMS);
          const handle = text(row, 'handle');
          if (onList(platform, handle)) return [];
          const state = oneOf(row, 'state', ['pending', 'invited'] as const);
          return [{ id: integer(row, 'id'), platform, handle, topics: topicsOf([row]), state }];
        });
    },

    /** Nominations for the team: waiting for an invite, most nominated first, and invited ones waiting for the nominee. */
    queue(): { readonly pending: QueuedNomination[]; readonly invited: QueuedNomination[] } {
      const rows = (state: 'pending' | 'invited') =>
        db.prepare(`SELECT * FROM nominations WHERE state = ? ORDER BY created_at, id`).all(state).map(toQueued);
      return { pending: rows('pending').sort((a, b) => b.nominators - a.nominators), invited: rows('invited') };
    },

    /** Invites a pending nomination. The link is shown once: only its hash is kept. */
    invite(id: number, reviewerId: number): Result<{ readonly nomination: QueuedNomination; readonly token: string }, InviteRefusal> {
      return decide(id, ['pending'], (row) => {
        const token = issueLink(integer(row, 'id'), reviewerId);
        return { nomination: toQueued({ ...row, decided_at: iso(now()) }), token };
      });
    },

    /** A new link for an invited nomination, when the team lost the first. The old link stops working. */
    relink(id: number, reviewerId: number): Result<{ readonly nomination: QueuedNomination; readonly token: string }, InviteRefusal> {
      return decide(id, ['invited'], (row) => {
        const token = issueLink(integer(row, 'id'), reviewerId);
        return { nomination: toQueued({ ...row, decided_at: iso(now()) }), token };
      });
    },

    /** The team will not invite this one. Its link, if it had one, stops working. */
    reject(id: number, reviewerId: number): Result<null, InviteRefusal> {
      return decide(id, ['pending', 'invited'], () => {
        db.prepare(`UPDATE nominations SET state = 'rejected', invite_token_hash = NULL, decided_at = ?, decided_by = ? WHERE id = ?`).run(iso(now()), reviewerId, id);
        return null;
      });
    },

    /** What a live invite link is for. Null once it is claimed, declined, replaced or withdrawn. */
    invitation(token: string): Invitation | null {
      const row = invited(token);
      if (!row) return null;
      const nominators = nominatorRows(integer(row, 'id'));
      return { platform: oneOf(row, 'platform', PLATFORMS), handle: text(row, 'handle'), nominators: nominators.length, topics: topicsOf(nominators) };
    },

    /** A signed-in member with a handle claims the invite: the account goes to Get ticked for proof, and the link is spent. */
    claim(memberId: number, token: string): Result<{ readonly platform: Platform }, ClaimRefusal | 'no-handle'> {
      return attempt<{ readonly platform: Platform }, ClaimRefusal | 'no-handle'>(db, (refuse) => {
        if (!hasHandle(db, memberId)) refuse('no-handle');
        return { platform: claimFor(memberId, invited(token) ?? refuse('not-found'), refuse) };
      });
    },

    /**
     * The nominee joins Social from the link: a new account, let in by the nomination, with the nominated account
     * waiting for proof. One transaction, so a link lets in one person.
     */
    join(token: string, input: { name: string; email: string; handle: string }): Result<{ readonly memberId: number; readonly platform: Platform }, JoinRefusal> {
      return attempt<{ readonly memberId: number; readonly platform: Platform }, JoinRefusal>(db, (refuse) => {
        const row = invited(token) ?? refuse('not-found');
        const memberId = openAccount(db, now(), input, { via: 'nomination' }, refuse);
        return { memberId, platform: claimFor(memberId, row, refuse) };
      });
    },

    /** The nominee says no: everything about the nomination goes, except that this handle is never invited again. */
    decline(token: string): boolean {
      return db.transaction(() => {
        const row = invited(token);
        if (!row) return false;
        const id = integer(row, 'id');
        db.prepare('DELETE FROM nominators WHERE nomination_id = ?').run(id);
        db.prepare(`UPDATE nominations SET state = 'removed', invite_token_hash = NULL, decided_at = ?, decided_by = NULL WHERE id = ?`).run(iso(now()), id);
        return true;
      });
    },
  };
}

export type SocialNominations = ReturnType<typeof createSocialNominations>;
