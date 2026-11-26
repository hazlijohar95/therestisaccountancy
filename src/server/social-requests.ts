import { attempt, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import type { Result } from './result.ts';
import { admit } from './social-profiles.ts';

/*
 * Requests to join Social, from people nobody has invited. The team reads each one and approves or declines it. The
 * public answer is the same whether or not the email has an account; only a request already waiting is told so.
 */

const STATES = ['pending', 'approved', 'declined'] as const;
export type RequestState = (typeof STATES)[number];

export interface RequestDraft {
  readonly name: string;
  readonly email: string;
  /** One line on who they are and where they post. */
  readonly about: string;
  /** An https link to a profile of theirs, if they gave one. */
  readonly link: string | null;
}

export interface SocialRequest extends RequestDraft {
  readonly id: number;
  readonly state: RequestState;
  readonly createdAt: string;
  /** The handle of the Social profile this email already holds, for the team. Null when it holds none. */
  readonly onSocial: string | null;
}

/**
 * What approving did. A newcomer, or someone who never set a password, gets the link to set one. Someone who signs in
 * already is told they are in, never sent a reset.
 */
export type Approval =
  | { readonly kind: 'welcome'; readonly memberId: number }
  | { readonly kind: 'sign-in'; readonly name: string; readonly email: string; readonly hasProfile: boolean };

/** 'pending': this email has a request waiting already. */
export type RequestRefusal = 'pending';
export type DecideRefusal = 'decided' | 'suspended';

const DAY_MS = 86_400_000;
/** Declined requests are deleted after this long. Approved ones stay: they say how someone got in. */
const KEEP_DECLINED_DAYS = 90;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const REQUESTS = 'SELECT r.*, (SELECT p.handle FROM members m JOIN profiles p ON p.member_id = m.id WHERE m.email = r.email) AS on_social FROM social_requests r';

const toRequest = (row: Row): SocialRequest => ({
  id: integer(row, 'id'),
  name: text(row, 'name'),
  email: text(row, 'email'),
  about: text(row, 'about'),
  link: optionalText(row, 'link'),
  state: oneOf(row, 'state', STATES),
  createdAt: text(row, 'created_at'),
  onSocial: optionalText(row, 'on_social'),
});

export function createSocialRequests(db: Db, now: () => Date = () => new Date()) {
  /** Inside a transaction: the pending request, or the refusal that someone already decided it. */
  const pending = (id: number, refuse: (reason: 'decided') => never): SocialRequest => {
    const row = db.prepare(`${REQUESTS} WHERE r.id = ? AND r.state = 'pending'`).get(id);
    return row ? toRequest(row) : refuse('decided');
  };

  const decide = (id: number, state: Exclude<RequestState, 'pending'>, teamId: number) => {
    db.prepare('UPDATE social_requests SET state = ?, decided_at = ?, decided_by = ? WHERE id = ?').run(state, iso(now()), teamId, id);
  };

  return {
    /** Saves a request. Refused while one from the same email is waiting. */
    request(draft: RequestDraft): Result<null, RequestRefusal> {
      return attempt<null, RequestRefusal>(db, (refuse) => {
        if (db.prepare(`SELECT 1 FROM social_requests WHERE email = ? AND state = 'pending'`).get(draft.email)) refuse('pending');
        db.prepare('INSERT INTO social_requests (name, email, about, link, created_at) VALUES (?, ?, ?, ?, ?)').run(draft.name, draft.email, draft.about, draft.link, iso(now()));
        return null;
      });
    },

    /** Requests waiting for the team, oldest first. */
    queue(): SocialRequest[] {
      return db.prepare(`${REQUESTS} WHERE r.state = 'pending' ORDER BY r.created_at, r.id`).all().map(toRequest);
    },

    /**
     * Lets the person in. A newcomer becomes a Social member without a password, like any sign-up; an email that has
     * an account already is let in on it. The handle comes after the password, on their first visit.
     */
    approve(id: number, teamId: number): Result<Approval, DecideRefusal> {
      return attempt<Approval, DecideRefusal>(db, (refuse) => {
        const request = pending(id, refuse);
        db.prepare(`INSERT INTO members (email, name, joined_via, joined_at) VALUES (?, ?, 'social', ?) ON CONFLICT (email) DO NOTHING`).run(request.email, request.name, iso(now()));
        const member = db.prepare('SELECT id, name, email, suspended_at, password_hash FROM members WHERE email = ?').get(request.email);
        if (!member) throw new Error(`Member ${request.email} was not saved`);
        if (optionalText(member, 'suspended_at') !== null) refuse('suspended');
        const memberId = integer(member, 'id');
        admit(db, now(), memberId, { via: 'request' });
        decide(id, 'approved', teamId);
        if (optionalText(member, 'password_hash') === null) return { kind: 'welcome', memberId };
        return { kind: 'sign-in', name: text(member, 'name'), email: text(member, 'email'), hasProfile: request.onSocial !== null };
      });
    },

    /** The team says no. The caller sends a short, polite email. */
    decline(id: number, teamId: number): Result<{ readonly name: string; readonly email: string }, 'decided'> {
      return attempt<{ readonly name: string; readonly email: string }, 'decided'>(db, (refuse) => {
        const request = pending(id, refuse);
        decide(id, 'declined', teamId);
        return { name: request.name, email: request.email };
      });
    },

    /** Deletes declined requests after KEEP_DECLINED_DAYS. Pending and approved ones stay. */
    prune(): number {
      const cutoff = iso(new Date(now().getTime() - KEEP_DECLINED_DAYS * DAY_MS));
      return db.prepare(`DELETE FROM social_requests WHERE state = 'declined' AND decided_at < ?`).run(cutoff).changes;
    },
  };
}

export type SocialRequests = ReturnType<typeof createSocialRequests>;
