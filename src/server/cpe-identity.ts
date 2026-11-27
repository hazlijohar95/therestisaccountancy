import type { Access } from './billing.ts';
import type { Member } from './club.ts';
import type { ClubIdentity } from './cpe-contract.ts';
import { paidAccess } from './paths.ts';

export type { ClubIdentity } from './cpe-contract.ts';

/**
 * Who is signed in, for the CPE Worker at cpe.<domain>. CPE has no accounts of its own: it asks the club over a
 * Worker-to-Worker binding, forwarding the browser's cookie, and the club answers from the same session its pages use.
 * This is the signed-in member as CPE sees them, or null when nobody is signed in or their session has ended.
 */
export async function identify(member: Member | null, access: (memberId: number) => Access | Promise<Access>): Promise<ClubIdentity | null> {
  if (!member) return null;
  const paid = paidAccess(member.role, await access(member.id));
  return { id: member.id, name: member.name, email: member.email, role: member.role, paid };
}

/** The session cookie's name, shared by the club's sign-in and CPE's forwarded cookie header. */
export const SESSION_COOKIE = 'session';

/** The session token in a Cookie header, or null when there is none. */
export function sessionToken(cookie: string | null): string | null {
  for (const pair of (cookie ?? '').split(';')) {
    const [name, ...value] = pair.split('=');
    if (name?.trim() === SESSION_COOKIE) return value.join('=').trim() || null;
  }
  return null;
}
