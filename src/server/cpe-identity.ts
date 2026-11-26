import type { Access } from './billing.ts';
import type { Member, Role } from './club.ts';
import { paidAccess } from './paths.ts';

/**
 * Who is signed in, for the CPE Worker at cpe.<domain>. CPE has no accounts of its own: it asks the club over a
 * Worker-to-Worker binding, forwarding the browser's cookie, and the club answers the way its own middleware would.
 */
export interface ClubIdentity {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  /** May use what membership pays for: an admin always, a member while paid or in grace. */
  readonly paid: boolean;
}

/** The signed-in member as CPE sees them, or null when nobody is signed in or their session has ended. */
export async function identify(member: Member | null, access: (memberId: number) => Access | Promise<Access>): Promise<ClubIdentity | null> {
  if (!member) return null;
  const paid = paidAccess(member.role, await access(member.id));
  return { id: member.id, name: member.name, email: member.email, role: member.role, paid };
}

/**
 * The on-demand route that answers the binding. It is never meant for a browser: the Worker refuses the path on public
 * requests, and the route itself answers only a request that carries this isolate's token.
 */
export const IDENTITY_PATH = '/internal/cpe-identity';

const TOKEN_HEADER = 'x-cpe-identity';
let token: string | null = null;

/** A random value made on first use in this isolate. Workers refuse random values at module scope, hence the lazy start. */
const isolateToken = () => (token ??= crypto.randomUUID());

/** The request the binding's method hands to Astro: the browser's cookie, and the token only this isolate knows. */
export function identityRequest(site: string, cookie: string | null): Request {
  const headers = new Headers({ [TOKEN_HEADER]: isolateToken() });
  if (cookie) headers.set('cookie', cookie);
  return new Request(new URL(IDENTITY_PATH, site), { headers });
}

/** Whether a request came from identityRequest in this isolate, rather than from outside. */
export function isIdentityRequest(request: Request): boolean {
  const sent = request.headers.get(TOKEN_HEADER);
  return token !== null && sent === token;
}

/** Reads the route's JSON back into an identity, so a change on either side fails loudly instead of passing bad data. */
export function parseIdentity(body: unknown): ClubIdentity | null {
  if (body === null) return null;
  if (typeof body !== 'object') throw new TypeError('identity is not an object');
  const { id, name, email, role, paid } = Object.fromEntries(Object.entries(body));
  if (typeof id !== 'number' || typeof name !== 'string' || typeof email !== 'string' || typeof paid !== 'boolean' || (role !== 'member' && role !== 'admin')) {
    throw new TypeError('identity has the wrong shape');
  }
  return { id, name, email, role, paid };
}
