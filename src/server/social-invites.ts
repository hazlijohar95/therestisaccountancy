import { createHash, randomBytes } from 'node:crypto';
import { INVITE_DAYS, MEMBER_INVITES } from '../data/social.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import type { Result } from './result.ts';
import { activeSql, admit, admitted, openAccount, type Entry, type SignUpRefusal } from './social-profiles.ts';

/*
 * Invite links. Social is invite-only: the team invites by email, and each member with a ticked credential has
 * MEMBER_INVITES links to hand out. A link works once, for INVITE_DAYS, and only its hash is kept, so it is shown once.
 * A link that was used, ran out, or was withdrawn says so, with the way to ask instead.
 */

const KINDS = ['team', 'member'] as const;
export type InviteKind = (typeof KINDS)[number];
export type InviteState = 'live' | 'used' | 'expired' | 'revoked';

export interface Invite {
  readonly id: number;
  readonly kind: InviteKind;
  readonly state: InviteState;
  /** Who the team invited. A member's invite names nobody: they pass the link on themselves. */
  readonly email: string | null;
  readonly name: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** Whoever used it, by handle, while their profile is public. */
  readonly usedBy: string | null;
}

/** What a link says to whoever opens it. */
export type Look =
  | { readonly state: 'live'; readonly kind: InviteKind; readonly email: string | null; readonly name: string | null; readonly inviter: { readonly name: string; readonly handle: string | null } }
  | { readonly state: Exclude<InviteState, 'live'> | 'unknown' };

/** What a member's invites stand at. */
export interface Allowance {
  /** They have a ticked credential and a profile, so they may invite. */
  readonly eligible: boolean;
  /** Invites they may still make: MEMBER_INVITES less those used or out now. */
  readonly left: number;
}

/** 'dead': the link was used, ran out, was withdrawn, or never existed. */
export type JoinRefusal = SignUpRefusal | 'dead';
export type RedeemRefusal = 'dead' | 'already-in';
export type TeamInviteRefusal = 'on-social';
export type MemberInviteRefusal = 'no-tick' | 'none-left';
export type RevokeRefusal = 'not-found' | 'used';

const DAY_MS = 86_400_000;
/** Dead links are kept this long, so opening one still says what happened to it. */
const KEEP_DEAD_DAYS = 30;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSocialInvites(db: Db, now: () => Date = () => new Date()) {
  /** The state of an invite row now. An invite from someone since suspended counts as withdrawn. */
  const stateOf = (row: Row): InviteState => {
    if (optionalText(row, 'used_at') !== null) return 'used';
    if (optionalText(row, 'revoked_at') !== null || integer(row, 'inviter_paused') === 1) return 'revoked';
    return text(row, 'expires_at') > iso(now()) ? 'live' : 'expired';
  };

  const INVITES = `SELECT i.*, (SELECT suspended_at IS NOT NULL FROM members WHERE id = i.inviter_id) AS inviter_paused,
    (SELECT handle FROM profiles WHERE member_id = i.used_by AND ${activeSql('i.used_by')}) AS used_handle
    FROM social_invites i`;

  const toInvite = (row: Row): Invite => ({
    id: integer(row, 'id'),
    kind: oneOf(row, 'kind', KINDS),
    state: stateOf(row),
    email: optionalText(row, 'email'),
    name: optionalText(row, 'name'),
    createdAt: text(row, 'created_at'),
    expiresAt: text(row, 'expires_at'),
    usedBy: optionalText(row, 'used_handle'),
  });

  const byToken = (token: string) => db.prepare(`${INVITES} WHERE i.token_hash = ?`).get(tokenHash(token));

  /** Inside a transaction: a new link. The token is returned once; only its hash is kept. */
  const issue = (kind: InviteKind, inviterId: number, to: { email: string; name: string | null } | null) => {
    const token = randomBytes(24).toString('base64url');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO social_invites (token_hash, kind, inviter_id, email, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(tokenHash(token), kind, inviterId, to?.email ?? null, to?.name ?? null, iso(now()), iso(new Date(now().getTime() + INVITE_DAYS * DAY_MS)));
    const row = db.prepare(`${INVITES} WHERE i.id = ?`).get(lastInsertRowid);
    if (!row) throw new Error(`Invite ${lastInsertRowid} was not saved`);
    return { token, invite: toInvite(row) };
  };

  /** The link's row while it is live, or the refusal that it is dead. */
  const live = (token: string, refuse: (reason: 'dead') => never): Row => {
    const row = byToken(token);
    return row && stateOf(row) === 'live' ? row : refuse('dead');
  };

  /** How a live link lets someone in. */
  const entryOf = (row: Row): Entry => (oneOf(row, 'kind', KINDS) === 'team' ? { via: 'team' } : { via: 'member', inviterId: integer(row, 'inviter_id') });

  /** Inside a transaction: the link is used, by this member, and works no more. */
  const spend = (row: Row, memberId: number) => {
    db.prepare('UPDATE social_invites SET used_at = ?, used_by = ? WHERE id = ?').run(iso(now()), memberId, integer(row, 'id'));
  };

  /** Invites that count against a member's allowance: used, or still out. Revoked and expired ones come back. */
  const spent = (memberId: number) =>
    count(
      db
        .prepare(`SELECT count(*) AS n FROM social_invites WHERE inviter_id = ? AND kind = 'member' AND (used_at IS NOT NULL OR (revoked_at IS NULL AND expires_at > ?))`)
        .get(memberId, iso(now())),
    );

  /** An active member with a profile and at least one ticked credential. */
  const eligible = (memberId: number) =>
    db
      .prepare(
        `SELECT 1 FROM profiles p WHERE p.member_id = ? AND ${activeSql('p.member_id')} AND EXISTS (SELECT 1 FROM claims WHERE member_id = p.member_id AND state = 'ticked')`,
      )
      .get(memberId) !== undefined;

  const allowance = (memberId: number): Allowance => ({ eligible: eligible(memberId), left: Math.max(0, MEMBER_INVITES - spent(memberId)) });

  return {
    /**
     * The team invites someone by email; the caller emails the link. A live team invite to the same address is
     * replaced, so the newest email is the one that works. Someone already on Social needs no invite.
     */
    inviteByEmail(teamId: number, to: { email: string; name: string | null }): Result<{ readonly token: string; readonly invite: Invite }, TeamInviteRefusal> {
      return attempt<{ readonly token: string; readonly invite: Invite }, TeamInviteRefusal>(db, (refuse) => {
        if (db.prepare('SELECT 1 FROM members m JOIN profiles p ON p.member_id = m.id WHERE m.email = ?').get(to.email)) refuse('on-social');
        db.prepare(`UPDATE social_invites SET revoked_at = ? WHERE kind = 'team' AND email = ? AND used_at IS NULL AND revoked_at IS NULL`).run(iso(now()), to.email);
        return issue('team', teamId, to);
      });
    },

    /** The team's invites: live ones, and any used, expired or withdrawn in the last KEEP_DEAD_DAYS. Newest first. */
    teamInvites(): Invite[] {
      return db.prepare(`${INVITES} WHERE i.kind = 'team' ORDER BY i.created_at DESC, i.id DESC LIMIT 100`).all().map(toInvite);
    },

    /** Withdraws a team invite that has not been used. */
    withdraw(inviteId: number): Result<null, RevokeRefusal> {
      return attempt<null, RevokeRefusal>(db, (refuse) => {
        const row = db.prepare(`SELECT used_at FROM social_invites WHERE id = ? AND kind = 'team'`).get(inviteId) ?? refuse('not-found');
        if (optionalText(row, 'used_at') !== null) refuse('used');
        db.prepare('UPDATE social_invites SET revoked_at = coalesce(revoked_at, ?) WHERE id = ?').run(iso(now()), inviteId);
        return null;
      });
    },

    allowance,

    /** A member makes a link to hand on. Refused without a ticked credential, or with every invite used or out. */
    create(memberId: number): Result<{ readonly token: string; readonly invite: Invite }, MemberInviteRefusal> {
      return attempt<{ readonly token: string; readonly invite: Invite }, MemberInviteRefusal>(db, (refuse) => {
        if (!eligible(memberId)) refuse('no-tick');
        const made = issue('member', memberId, null);
        /* Counted after the write, so two at once cannot both take the last one. */
        if (spent(memberId) > MEMBER_INVITES) refuse('none-left');
        return made;
      });
    },

    /** A member's own invites, newest first. */
    mine(memberId: number): Invite[] {
      return db.prepare(`${INVITES} WHERE i.inviter_id = ? AND i.kind = 'member' ORDER BY i.created_at DESC, i.id DESC`).all(memberId).map(toInvite);
    },

    /** A member withdraws one of their own invites that has not been used. It goes back to their allowance. */
    revoke(memberId: number, inviteId: number): Result<null, RevokeRefusal> {
      return attempt<null, RevokeRefusal>(db, (refuse) => {
        const row = db.prepare(`SELECT used_at FROM social_invites WHERE id = ? AND inviter_id = ? AND kind = 'member'`).get(inviteId, memberId) ?? refuse('not-found');
        if (optionalText(row, 'used_at') !== null) refuse('used');
        db.prepare('UPDATE social_invites SET revoked_at = coalesce(revoked_at, ?) WHERE id = ?').run(iso(now()), inviteId);
        return null;
      });
    },

    /** What a link is, for the page it opens. */
    look(token: string): Look {
      const row = byToken(token);
      if (!row) return { state: 'unknown' };
      const state = stateOf(row);
      if (state !== 'live') return { state };
      const inviter = db.prepare('SELECT m.name, p.handle FROM members m LEFT JOIN profiles p ON p.member_id = m.id WHERE m.id = ?').get(integer(row, 'inviter_id'));
      if (!inviter) return { state: 'revoked' };
      return {
        state,
        kind: oneOf(row, 'kind', KINDS),
        email: optionalText(row, 'email'),
        name: optionalText(row, 'name'),
        inviter: { name: text(inviter, 'name'), handle: optionalText(inviter, 'handle') },
      };
    },

    /**
     * Someone new joins Social from a link: a new account with a handle, let in by the invite, which is spent. One
     * transaction, so a link lets in one person. The caller sends the link to set a password.
     */
    join(token: string, input: { name: string; email: string; handle: string }): Result<{ readonly memberId: number }, JoinRefusal> {
      return attempt<{ readonly memberId: number }, JoinRefusal>(db, (refuse) => {
        const row = live(token, refuse);
        const memberId = openAccount(db, now(), input, entryOf(row), refuse);
        spend(row, memberId);
        return { memberId };
      });
    },

    /** A signed-in member without a way in uses a link: they are let in, and pick their handle next. */
    redeem(memberId: number, token: string): Result<null, RedeemRefusal> {
      return attempt<null, RedeemRefusal>(db, (refuse) => {
        const row = live(token, refuse);
        if (admitted(db, memberId)) refuse('already-in');
        admit(db, now(), memberId, entryOf(row));
        spend(row, memberId);
        return null;
      });
    },

    /** Deletes links that have been dead for KEEP_DEAD_DAYS and were never used. Used ones stay: they count. */
    prune(): number {
      const cutoff = iso(new Date(now().getTime() - KEEP_DEAD_DAYS * DAY_MS));
      return db.prepare('DELETE FROM social_invites WHERE used_at IS NULL AND (expires_at < ? OR revoked_at < ?)').run(cutoff, cutoff).changes;
    },
  };
}

export type SocialInvites = ReturnType<typeof createSocialInvites>;
