import { waitingOf, type Waiting } from '../lib/waiting.ts';
import { issueLink, toMember } from './club.ts';
import { attempt, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import type { Letter } from './letters.ts';
import { socialUrl, welcomeUrl } from './paths.ts';
import type { Result } from './result.ts';
import { requestApprovedLetter } from './social-letters.ts';
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

  const queue = (): SocialRequest[] => db.prepare(`${REQUESTS} WHERE r.state = 'pending' ORDER BY r.created_at, r.id`).all().map(toRequest);

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
    queue,

    /** Requests waiting for the team, and since the oldest came in. */
    waiting: (): Waiting => waitingOf(queue().map((r) => r.createdAt)),

    /**
     * Lets the person in, and writes to them. A newcomer becomes a Social member without a password, like any sign-up,
     * and gets the link to set one; an email that has an account already is let in on it, and someone who signs in
     * already is told so, never sent a reset. The handle comes after the password, on their first visit.
     */
    approve(id: number, teamId: number, siteUrl: string): Result<Letter[], DecideRefusal> {
      return attempt<Letter[], DecideRefusal>(db, (refuse) => {
        const at = now();
        const request = pending(id, refuse);
        db.prepare(`INSERT INTO members (email, name, joined_via, joined_at) VALUES (?, ?, 'social', ?) ON CONFLICT (email) DO NOTHING`).run(request.email, request.name, iso(at));
        const row = db.prepare('SELECT * FROM members WHERE email = ?').get(request.email);
        if (!row) throw new Error(`Member ${request.email} was not saved`);
        const member = toMember(row);
        if (member.status === 'suspended') refuse('suspended');
        admit(db, at, member.id, { via: 'request' });
        /* Their welcome link starts now, so the clock for sign-ups abandoned before a password starts again too. */
        db.prepare('UPDATE members SET joined_at = ? WHERE id = ? AND password_hash IS NULL').run(iso(at), member.id);
        decide(id, 'approved', teamId);
        if (member.status === 'active') {
          const signIn = new URL(`/sign-in?next=${encodeURIComponent(socialUrl(siteUrl, '/me'))}`, siteUrl).href;
          return [requestApprovedLetter(member, { signIn, hasProfile: request.onSocial !== null })];
        }
        const link = issueLink(db, at, member) ?? refuse('suspended');
        return [requestApprovedLetter(member, { link: welcomeUrl(siteUrl, link.token), expiresAt: link.expiresAt })];
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
