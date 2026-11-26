import { notFound, redirect, type NotFoundError } from '@tanstack/react-router';
import { getRequest } from '@tanstack/react-start/server';
import { clubAway, decide, type Actor, type Decision, type Denial, type Level, type Lookups } from './access.ts';
import { currentMember } from './session.server.ts';
import { withStore } from './store.server.ts';

/* The access decision for this request, and the ways a page or a server route turns someone away. */

const lookups: Lookups = {
  billing: { access: (memberId) => withStore(async (store) => await store.billing.access(memberId)) },
  socialProfiles: { ownProfile: (memberId) => withStore(async (store) => await store.socialProfiles.ownProfile(memberId)) },
};

/** Whether the signed-in member may act at level. */
export const check = async <L extends Level>(level: L): Promise<Decision<L>> => decide(level, await currentMember(), lookups);

/** What a page throws at someone it turns away: a redirect, a not-found, or a server route's own response. */
export type Away<L extends Level> = (denial: Denial<L>, here: URL) => Response | NotFoundError;

/** For loaders and server routes: who acts at level, or a throw of where away sends everyone else. */
export async function admit<L extends Level>(level: L, away: Away<NoInfer<L>>): Promise<Actor<L>> {
  const decision = await check(level);
  if (decision.ok) return decision.actor;
  throw away(decision.denial, new URL(getRequest().url));
}

/** A club page: sign in and come back, pay, or go to the members' area. */
export const toClub: Away<'member' | 'paid' | 'admin'> = (denial, here) => redirect({ href: clubAway[denial](here.pathname + here.search) });

/** A page whose very existence is the team's: everyone else gets a 404. */
export const hidden = () => notFound();
