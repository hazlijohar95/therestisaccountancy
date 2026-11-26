import type { Access } from '../../../src/server/billing.ts';
import type { Member } from '../../../src/server/club.ts';
import { paidAccess } from '../../../src/server/paths.ts';
import type { Profile } from '../../../src/server/social-profiles.ts';
import { refused, type Outcome } from './outcome.ts';

/*
 * Who may do what. One decision per access level, over who is signed in and, only when the level turns on them, their
 * billing and their Social profile. Framework-free, so tests decide without a request.
 */

export const LEVELS = ['anyone', 'member', 'paid', 'profile', 'admin'] as const;
export type Level = (typeof LEVELS)[number];

/** Who is signed in, as much of them as a decision reads. A Member, or the root route's view of one. */
export interface Who {
  readonly id: number;
  readonly role: Member['role'];
}

/** Who acts at each level, and each reason the level can say no. */
interface Levels<M extends Who> {
  anyone: { actor: M | null; denial: never };
  member: { actor: M; denial: 'signed-out' };
  paid: { actor: M; denial: 'signed-out' | 'unpaid' };
  profile: { actor: Profile; denial: 'signed-out' | 'no-handle' };
  admin: { actor: M; denial: 'signed-out' | 'not-admin' };
}

export type Actor<L extends Level, M extends Who = Member> = Levels<M>[L]['actor'];
export type Denial<L extends Level = Level> = Levels<Who>[L]['denial'];
export type Decision<L extends Level, M extends Who = Member> = { readonly ok: true; readonly actor: Actor<L, M> } | { readonly ok: false; readonly denial: Denial<L> };

/** What a decision may look up. The store answers it, in production across RPC and in tests directly. */
export interface Lookups {
  readonly billing: { access(memberId: number): Access | Promise<Access> };
  readonly socialProfiles: { ownProfile(memberId: number): Profile | null | Promise<Profile | null> };
}

type Rules = { readonly [L in Level]: <M extends Who>(member: M | null, lookups: Lookups) => Promise<Decision<L, M>> };

const rules: Rules = {
  anyone: async (member) => ({ ok: true, actor: member }),
  member: async (member) => (member ? { ok: true, actor: member } : { ok: false, denial: 'signed-out' }),
  paid: async (member, lookups) => {
    if (!member) return { ok: false, denial: 'signed-out' };
    if (member.role === 'admin' || paidAccess(member.role, await lookups.billing.access(member.id))) return { ok: true, actor: member };
    return { ok: false, denial: 'unpaid' };
  },
  profile: async (member, lookups) => {
    if (!member) return { ok: false, denial: 'signed-out' };
    const profile = await lookups.socialProfiles.ownProfile(member.id);
    return profile ? { ok: true, actor: profile } : { ok: false, denial: 'no-handle' };
  },
  admin: async (member) => {
    if (!member) return { ok: false, denial: 'signed-out' };
    return member.role === 'admin' ? { ok: true, actor: member } : { ok: false, denial: 'not-admin' };
  },
};

/** Whether member may act at level: who acts, or why not. Admins never pay. */
export const decide = <L extends Level, M extends Who>(level: L, member: M | null, lookups: Lookups): Promise<Decision<L, M>> => rules[level](member, lookups);

/** What a form shows for each denial. */
export const denials: Readonly<Record<Denial, string>> = {
  'signed-out': 'Sign in first.',
  'not-admin': 'Only a club admin can do that.',
  unpaid: 'Your membership needs a payment first.',
  'no-handle': 'Claim your handle first.',
};

export const refusal = (denial: Denial): Outcome<never> => refused(denials[denial]);

/** Where a club page sends someone it turns away. here is the page's path and query, to come back to after signing in. */
export const clubAway: Readonly<Record<Denial<'paid' | 'admin'>, (here: string) => string>> = {
  'signed-out': (here) => `/sign-in?next=${encodeURIComponent(here)}`,
  unpaid: () => '/members/pay',
  'not-admin': () => '/members',
};
