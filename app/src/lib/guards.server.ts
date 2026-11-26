import { redirect } from '@tanstack/react-router';
import { getRequest } from '@tanstack/react-start/server';
import type { Member } from '../../../src/server/club.ts';
import { paidAccess } from '../../../src/server/paths.ts';
import { done, refused, type Outcome } from './outcome.ts';
import { currentMember } from './session.server.ts';
import { withStore } from './store.server.ts';

/*
 * Who may do what, for server functions. A mutation answers a refusal the form can show; a loader redirects instead,
 * so a page reached signed out sends the visitor to sign in and back.
 */

/** The signed-in member, or the refusal to show. */
export async function memberOrRefusal(): Promise<Outcome<Member>> {
  const member = await currentMember();
  return member ? done(member) : refused('Sign in first.');
}

/** An admin, or the refusal to show. */
export async function adminOrRefusal(): Promise<Outcome<Member>> {
  const member = await currentMember();
  if (!member) return refused('Sign in first.');
  return member.role === 'admin' ? done(member) : refused('Only a club admin can do that.');
}

/** A member whose membership is paid or in its grace period, or the refusal. Admins never pay. */
export async function paidOrRefusal(): Promise<Outcome<Member>> {
  const member = await currentMember();
  if (!member) return refused('Sign in first.');
  const access = await withStore((store) => store.billing.access(member.id));
  return paidAccess(member.role, access) ? done(member) : refused('Your membership needs a payment first.');
}

/** For loaders: the signed-in member, or a redirect to sign in and come back to this page. */
export async function memberOrSignIn(): Promise<Member> {
  const member = await currentMember();
  if (member) return member;
  const url = new URL(getRequest().url);
  throw redirect({ href: `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}` });
}
