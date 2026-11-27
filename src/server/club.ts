import { createHash, randomBytes } from 'node:crypto';
import { LINK_DAYS, type LinkPurpose } from '../data/links.ts';
import { callLetters, standDown, type Call } from './calls.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import type { Letter } from './letters.ts';
import { hashPassword, spendVerifyTime, verifyPassword } from './password.ts';
import { fail, ok, type Result } from './result.ts';

export const REQUEST_STATUSES = ['pending', 'invited', 'declined'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const ROLES = ['member', 'admin'] as const;
export type Role = (typeof ROLES)[number];
/** Invited: has no password yet. Active: can sign in. Suspended: kept on record, but cannot sign in or get a link. */
export const MEMBER_STATUSES = ['invited', 'active', 'suspended'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
/** Where someone first joined: the paid club, or the free social site. It decides where they land and what they are told. */
export const JOINED_VIA = ['club', 'social'] as const;
export type JoinedVia = (typeof JOINED_VIA)[number];

export interface JoinRequest {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly stage: string;
  readonly status: RequestStatus;
  readonly createdAt: string;
}

export interface Member {
  readonly id: number;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly status: MemberStatus;
  readonly joinedAt: string;
  readonly joinedVia: JoinedVia;
  /**
   * May pay for the club. Everyone who joined through the club may; someone from the free social site may once an
   * admin accepts a join request from them.
   */
  readonly clubApproved: boolean;
}

/**
 * What accepting a join request did: a password link to send, or, for someone who already signs in on the social
 * site, approval to pay with nothing new to set up.
 */
export type Invitation = { readonly kind: 'link'; readonly link: PasswordLink } | { readonly kind: 'approved'; readonly member: Member };

export { LINK_DAYS, type LinkPurpose };

/** What a password link does for a member in each status. A suspended member gets none. */
export const LINK_FOR = { invited: 'welcome', active: 'reset', suspended: null } as const satisfies Record<MemberStatus, LinkPurpose | null>;

export interface PasswordLink {
  readonly member: Member;
  readonly purpose: LinkPurpose;
  /** Shown once. Only its hash is stored. */
  readonly token: string;
  readonly expiresAt: string;
}

/** What a session holds. The epoch moves on every password change and suspension, which ends every older session. */
export interface SessionKey {
  readonly memberId: number;
  readonly epoch: number;
}

export interface Access {
  readonly member: Member;
  readonly key: SessionKey;
}

export interface MemberFilter {
  readonly query?: string | undefined;
  readonly status?: MemberStatus | undefined;
  readonly limit: number;
  readonly offset: number;
}

export type InviteRefusal = 'decided' | 'suspended';
export type LinkRefusal = 'not-found' | 'suspended';
export type SignInRefusal = 'no-match' | 'suspended';
/** Why an admin's change to a member was refused. Every admin operation leaves at least one active admin. */
export type AdminRefusal = 'not-found' | 'self' | 'last-admin';
export type EditRefusal = AdminRefusal | 'email-taken';

/** A change an admin made to a member, and the letters it calls for: calls off for the members who booked with a host who no longer hosts. */
export interface AdminChange {
  readonly member: Member;
  readonly letters: Letter[];
}

const toRequest = (row: Row): JoinRequest => ({
  id: integer(row, 'id'),
  name: text(row, 'name'),
  email: text(row, 'email'),
  stage: text(row, 'stage'),
  status: oneOf(row, 'status', REQUEST_STATUSES),
  createdAt: text(row, 'created_at'),
});

const statusOf = (row: Row): MemberStatus =>
  optionalText(row, 'suspended_at') !== null ? 'suspended' : optionalText(row, 'password_hash') === null ? 'invited' : 'active';

/** The SQL condition for each status. Kept beside statusOf so the two cannot drift apart. */
export const STATUS_SQL = {
  invited: 'password_hash IS NULL AND suspended_at IS NULL',
  active: 'password_hash IS NOT NULL AND suspended_at IS NULL',
  suspended: 'suspended_at IS NOT NULL',
} as const satisfies Record<MemberStatus, string>;

/** Where news for the admins goes: every active admin's email. Shared with the domain modules whose use cases end in mail to them. */
export const adminEmails = (db: Db): string[] =>
  db.prepare(`SELECT email FROM members WHERE role = 'admin' AND ${STATUS_SQL.active} ORDER BY id`).all().map((row) => text(row, 'email'));

export const toMember = (row: Row): Member => ({
  id: integer(row, 'id'),
  email: text(row, 'email'),
  name: text(row, 'name'),
  role: oneOf(row, 'role', ROLES),
  status: statusOf(row),
  joinedAt: text(row, 'joined_at'),
  joinedVia: oneOf(row, 'joined_via', JOINED_VIA),
  clubApproved: text(row, 'joined_via') === 'club' || optionalText(row, 'club_approved_at') !== null,
});

const toAccess = (row: Row): Access => {
  const member = toMember(row);
  return { member, key: { memberId: member.id, epoch: integer(row, 'session_epoch') } };
};

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, '\\$&')}%`;
const DAY_MS = 86_400_000;
/** A member asking for their own link gets at most one in this window, so the form cannot be used to flood an inbox. */
const LINK_REQUEST_GAP_MS = 10 * 60_000;
/** Admins hear of at most this many new join requests an hour. The rest still wait on the admin page. */
export const JOIN_ALERTS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

/** The members who booked with a host who no longer hosts are told as if the host had cancelled. */
const calledOff = (calls: readonly Call[], siteUrl: string): Letter[] => calls.flatMap((call) => callLetters('cancelled-by-host', call, siteUrl));

const retireLinks = (db: Db, at: Date, memberId: number) => {
  db.prepare('UPDATE invites SET used_at = ? WHERE member_id = ? AND used_at IS NULL').run(iso(at), memberId);
};

/**
 * Inside a transaction: a fresh password link, retiring the member's older ones. Null for a suspended member. The one
 * place links are made, so the suspension rule holds for invitations and resets alike.
 */
export function issueLink(db: Db, at: Date, member: Member): PasswordLink | null {
  const purpose = LINK_FOR[member.status];
  if (purpose === null) return null;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = iso(new Date(at.getTime() + LINK_DAYS[purpose] * DAY_MS));
  retireLinks(db, at, member.id);
  db.prepare('INSERT INTO invites (token_hash, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), member.id, expiresAt, iso(at));
  return { member, purpose, token, expiresAt };
}

/** Inside a transaction: the welcome link for an account just opened, which cannot be suspended yet. */
export function welcomeLink(db: Db, at: Date, memberId: number): PasswordLink {
  const row = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  const link = row ? issueLink(db, at, toMember(row)) : null;
  if (!link) throw new Error(`Member ${memberId} cannot get a link`);
  return link;
}

/** Every operation the club performs on its members. The database is passed in so tests can use a throwaway one. */
export function createClub(db: Db, now: () => Date = () => new Date()) {
  const memberRow = (id: number) => db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  const memberByEmail = (email: string) => db.prepare('SELECT * FROM members WHERE email = ?').get(email);
  const activeAdmins = () => count(db.prepare(`SELECT count(*) AS n FROM members WHERE role = 'admin' AND ${STATUS_SQL.active}`).get());


  const liveLinkMember = (token: string) =>
    db
      .prepare(
        'SELECT m.* FROM invites i JOIN members m ON m.id = i.member_id WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > ? AND m.suspended_at IS NULL',
      )
      .get(tokenHash(token), iso(now()));

  /** Every password write goes through here: open links are retired and older sessions end. */
  const writePassword = (memberId: number, passwordHash: string): Access => {
    db.prepare('UPDATE members SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?').run(passwordHash, memberId);
    retireLinks(db, now(), memberId);
    const row = memberRow(memberId);
    if (!row) throw new Error(`Member ${memberId} does not exist`);
    return toAccess(row);
  };

  /** The member an admin is acting on. Refuses a missing one, and the admin themselves unless allowSelf. */
  const subject = (actorId: number, memberId: number, refuse: (reason: AdminRefusal) => never, allowSelf = false): Member => {
    const row = memberRow(memberId);
    if (!row) return refuse('not-found');
    if (!allowSelf && actorId === memberId) return refuse('self');
    return toMember(row);
  };

  /** Checked after the write, inside the transaction, so two admins demoting each other cannot both succeed. */
  const keepAnAdmin = (refuse: (reason: AdminRefusal) => never) => {
    if (activeAdmins() === 0) refuse('last-admin');
  };

  const appoint = (input: { email: string; name: string }): Member => {
    db.prepare(`INSERT INTO members (email, name, role) VALUES (?, ?, 'admin') ON CONFLICT (email) DO NOTHING`).run(input.email, input.name);
    db.prepare(`UPDATE members SET role = 'admin', suspended_at = NULL WHERE email = ?`).run(input.email);
    const row = memberByEmail(input.email);
    if (!row) throw new Error('Admin was not saved');
    return toMember(row);
  };

  const reread = (memberId: number): Member => {
    const row = memberRow(memberId);
    if (!row) throw new Error(`Member ${memberId} does not exist`);
    return toMember(row);
  };

  return {
    /** Saves a request. A second request from the same email while one is pending updates it instead. */
    /** Saves the request, or refreshes the pending one from the same email. True when the admins should be told: a new request within the hourly allowance. */
    recordJoinRequest(input: { name: string; email: string; stage: string }): boolean {
      return db.transaction(() => {
        const repeat = db.prepare(`SELECT 1 FROM join_requests WHERE email = ? AND status = 'pending'`).get(input.email) !== undefined;
        const lastHour = count(db.prepare('SELECT count(*) AS n FROM join_requests WHERE created_at > ?').get(iso(new Date(now().getTime() - HOUR_MS))));
        db.prepare(
          `INSERT INTO join_requests (name, email, stage, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (email) WHERE status = 'pending' DO UPDATE SET name = excluded.name, stage = excluded.stage, created_at = excluded.created_at`,
        ).run(input.name, input.email, input.stage, iso(now()));
        return !repeat && lastHour < JOIN_ALERTS_PER_HOUR;
      });
    },

    /** Pending requests, or the most recent decisions, newest first. Without a filter, all of them, pending first. */
    joinRequests(filter: { decided?: boolean; limit?: number } = {}): JoinRequest[] {
      const where = filter.decided === undefined ? '' : filter.decided ? `WHERE status != 'pending'` : `WHERE status = 'pending'`;
      return db
        .prepare(`SELECT * FROM join_requests ${where} ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT ?`)
        .all(filter.limit ?? -1)
        .map(toRequest);
    },

    /**
     * Accepts a pending request: the person becomes a member and gets a link to set a password. If the email already
     * belongs to a member, that member gets the link instead, and only a member who has not set a password is renamed.
     * Someone from the social site is approved to pay, and keeps their account: with a password already set, they
     * need no link at all.
     */
    inviteFromRequest(requestId: number): Result<Invitation, InviteRefusal> {
      return attempt<Invitation, InviteRefusal>(db, (refuse) => {
        const row = db.prepare(`SELECT * FROM join_requests WHERE id = ? AND status = 'pending'`).get(requestId);
        if (!row) return refuse('decided');
        const request = toRequest(row);
        db.prepare(`INSERT INTO members (email, name) VALUES (?, ?) ON CONFLICT (email) DO UPDATE SET name = excluded.name WHERE password_hash IS NULL`).run(
          request.email,
          request.name,
        );
        db.prepare(`UPDATE members SET club_approved_at = ? WHERE email = ? AND joined_via = 'social' AND club_approved_at IS NULL`).run(iso(now()), request.email);
        const saved = memberByEmail(request.email);
        if (!saved) throw new Error(`Member ${request.email} was not saved`);
        const member = toMember(saved);
        if (member.status === 'suspended') return refuse('suspended');
        db.prepare(`UPDATE join_requests SET status = 'invited', decided_at = ?, member_id = ? WHERE id = ?`).run(iso(now()), member.id, request.id);
        if (member.joinedVia === 'social' && member.status === 'active') return { kind: 'approved', member };
        const link = issueLink(db, now(), member) ?? refuse('suspended');
        return { kind: 'link', link };
      });
    },

    declineRequest(requestId: number): boolean {
      const result = db.prepare(`UPDATE join_requests SET status = 'declined', decided_at = ? WHERE id = ? AND status = 'pending'`).run(iso(now()), requestId);
      return result.changes > 0;
    },

    /** A fresh invitation, or a reset link for a member who has a password. Earlier links stop working. */
    newLink(memberId: number): Result<PasswordLink, LinkRefusal> {
      return attempt<PasswordLink, LinkRefusal>(db, (refuse) => {
        const row = memberRow(memberId);
        if (!row) return refuse('not-found');
        return issueLink(db, now(), toMember(row)) ?? refuse('suspended');
      });
    },

    /**
     * A link the member asked for themselves, by email. Null when the email belongs to nobody, to a suspended member,
     * or to someone sent a link in the last few minutes. The caller answers every case the same way.
     */
    requestLink(email: string): PasswordLink | null {
      return db.transaction(() => {
        const row = memberByEmail(email);
        if (!row) return null;
        const since = iso(new Date(now().getTime() - LINK_REQUEST_GAP_MS));
        if (db.prepare('SELECT 1 FROM invites WHERE member_id = ? AND created_at > ?').get(integer(row, 'id'), since)) return null;
        return issueLink(db, now(), toMember(row));
      });
    },

    /** Where news for the admins goes: every active admin's email. */
    adminEmails: () => adminEmails(db),

    member(id: number): Member | null {
      const row = memberRow(id);
      return row ? toMember(row) : null;
    },

    /** One page of members, oldest first, matching an optional name-or-email search and status. */
    members(filter: MemberFilter): { items: Member[]; total: number } {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.query) {
        where.push(`(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`);
        params.push(likePattern(filter.query), likePattern(filter.query));
      }
      if (filter.status) where.push(STATUS_SQL[filter.status]);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return {
        items: db.prepare(`SELECT * FROM members ${clause} ORDER BY id LIMIT ? OFFSET ?`).all(...params, filter.limit, filter.offset).map(toMember),
        total: count(db.prepare(`SELECT count(*) AS n FROM members ${clause}`).get(...params)),
      };
    },

    memberCounts(): Record<MemberStatus, number> {
      const of = (status: MemberStatus) => count(db.prepare(`SELECT count(*) AS n FROM members WHERE ${STATUS_SQL[status]}`).get());
      return { invited: of('invited'), active: of('active'), suspended: of('suspended') };
    },

    /**
     * Name, email and role. An admin cannot change their own role; leave role out to keep it. A host who stops being an
     * admin calls off their booked calls.
     */
    updateMember(actorId: number, memberId: number, changes: { name: string; email: string; role?: Role | undefined }, siteUrl: string): Result<AdminChange, EditRefusal> {
      return attempt<AdminChange, EditRefusal>(db, (refuse) => {
        const member = subject(actorId, memberId, refuse, true);
        const role = changes.role ?? member.role;
        if (role !== member.role && actorId === memberId) refuse('self');
        if (db.prepare('SELECT 1 FROM members WHERE email = ? AND id != ?').get(changes.email, memberId)) refuse('email-taken');
        const booked = member.role === 'admin' && role !== 'admin' ? standDown(db, now(), memberId) : [];
        db.prepare('UPDATE members SET name = ?, email = ?, role = ? WHERE id = ?').run(changes.name, changes.email, role, memberId);
        keepAnAdmin(refuse);
        return { member: reread(memberId), letters: calledOff(booked, siteUrl) };
      });
    },

    /** Signs the member out everywhere and stops them signing in or using a link, until reinstated. Safe to repeat. */
    suspendMember(actorId: number, memberId: number, siteUrl: string): Result<AdminChange, AdminRefusal> {
      return attempt<AdminChange, AdminRefusal>(db, (refuse) => {
        subject(actorId, memberId, refuse);
        const booked = standDown(db, now(), memberId);
        db.prepare('UPDATE members SET suspended_at = ?, session_epoch = session_epoch + 1 WHERE id = ? AND suspended_at IS NULL').run(iso(now()), memberId);
        retireLinks(db, now(), memberId);
        keepAnAdmin(refuse);
        return { member: reread(memberId), letters: calledOff(booked, siteUrl) };
      });
    },

    /** Lets a suspended member sign in again with their password. Sessions from before the suspension stay ended. */
    reinstateMember(memberId: number): Result<Member, 'not-found'> {
      db.prepare('UPDATE members SET suspended_at = NULL WHERE id = ?').run(memberId);
      const row = memberRow(memberId);
      return row ? ok(toMember(row)) : fail('not-found');
    },

    /** Deletes the member, their progress, links and join request. Their posts stay, without a name. */
    removeMember(actorId: number, memberId: number, siteUrl: string): Result<AdminChange, AdminRefusal> {
      return attempt<AdminChange, AdminRefusal>(db, (refuse) => {
        const member = subject(actorId, memberId, refuse);
        const booked = standDown(db, now(), memberId);
        db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
        keepAnAdmin(refuse);
        return { member, letters: calledOff(booked, siteUrl) };
      });
    },

    /** The member an unused, unexpired link belongs to. */
    linkMember(token: string): Member | null {
      const row = liveLinkMember(token);
      return row ? toMember(row) : null;
    },

    /** Sets the password and spends the link. Null if the link is unknown, used or expired, or the member is suspended. */
    async setPasswordFromLink(token: string, password: string): Promise<(Access & { purpose: LinkPurpose }) | null> {
      if (!liveLinkMember(token)) return null;
      const passwordHash = await hashPassword(password);
      return db.transaction(() => {
        const row = liveLinkMember(token);
        const purpose = row ? LINK_FOR[statusOf(row)] : null;
        if (!row || purpose === null) return null;
        return { ...writePassword(integer(row, 'id'), passwordHash), purpose };
      });
    },

    /** A suspended member is told so only after proving the password, so the answer reveals nothing to a guesser. */
    async authenticate(email: string, password: string): Promise<Result<Access, SignInRefusal>> {
      const row = memberByEmail(email);
      const stored = row ? optionalText(row, 'password_hash') : null;
      if (!row || stored === null) {
        await spendVerifyTime(password);
        return fail('no-match');
      }
      if (!(await verifyPassword(password, stored))) return fail('no-match');
      return statusOf(row) === 'suspended' ? fail('suspended') : ok(toAccess(row));
    },

    /** The member a session belongs to, while they are active and nothing has ended the session since. */
    sessionMember(key: SessionKey): Member | null {
      const row = memberRow(key.memberId);
      if (!row || statusOf(row) !== 'active' || integer(row, 'session_epoch') !== key.epoch) return null;
      return toMember(row);
    },

    async changePassword(memberId: number, current: string, next: string): Promise<Access | null> {
      const row = memberRow(memberId);
      const stored = row ? optionalText(row, 'password_hash') : null;
      if (stored === null || !(await verifyPassword(current, stored))) return null;
      const passwordHash = await hashPassword(next);
      return db.transaction(() => {
        const latest = memberRow(memberId);
        return latest && optionalText(latest, 'password_hash') === stored ? writePassword(memberId, passwordHash) : null;
      });
    },

    /**
     * Makes the email an admin, creating them as an invited member if new, and lifts any suspension. Their password is
     * left alone: a new admin sets one with a link. The way back in when no admin can sign in.
     */
    appointAdmin(input: { email: string; name: string }): Member {
      return db.transaction(() => appoint(input));
    },

    /** Appoints the admin and sets their password. For tests and local tools; the site appoints and sends a link. */
    async ensureAdmin(input: { email: string; name: string; password: string }): Promise<Member> {
      const passwordHash = await hashPassword(input.password);
      return db.transaction(() => {
        const { id } = appoint(input);
        db.prepare('UPDATE members SET name = ? WHERE id = ?').run(input.name, id);
        return writePassword(id, passwordHash).member;
      });
    },

    completedLessons(memberId: number): Set<string> {
      const rows = db.prepare('SELECT lesson_id FROM lesson_progress WHERE member_id = ?').all(memberId);
      return new Set(rows.map((row) => text(row, 'lesson_id')));
    },

    setLessonDone(memberId: number, lessonId: string, done: boolean): void {
      if (done) db.prepare('INSERT INTO lesson_progress (member_id, lesson_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(memberId, lessonId);
      else db.prepare('DELETE FROM lesson_progress WHERE member_id = ? AND lesson_id = ?').run(memberId, lessonId);
    },
  };
}

export type Club = ReturnType<typeof createClub>;

/** Member numbers are the row id, printed four wide: No. 0001. */
export const memberNumber = (member: Pick<Member, 'id'>) => String(member.id).padStart(4, '0');
