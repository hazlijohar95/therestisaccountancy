import { redirect } from '@tanstack/react-router';
import type { Member } from '../../../src/server/club.ts';
import { paidAccess } from '../../../src/server/paths.ts';
import { memberOrSignIn } from './guards.server.ts';
import { withStore } from './store.server.ts';

/**
 * For the loaders of members' pages that membership pays for: the member, or a redirect. Signed out goes to sign in,
 * and a member with nothing paid goes to pay. Admins never pay. The /members layout redirects the same way before a
 * page loads; this is the check that holds when a server function is called on its own.
 */
export async function paidMemberOrRedirect(): Promise<Member> {
  const member = await memberOrSignIn();
  if (member.role === 'admin') return member;
  const access = await withStore((store) => store.billing.access(member.id));
  if (!paidAccess(member.role, access)) throw redirect({ href: '/members/pay' });
  return member;
}
