/**
 * The contract between the club and the CPE Worker (cpe/), imported by both sides so neither can change it alone. CPE
 * calls the club's CpeIdentity entrypoint (app/src/server.ts) over a service binding, forwarding the browser's cookie.
 * Types only and one guard: no imports, so CPE's build pulls in nothing else from the club.
 */

export interface ClubIdentity {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: 'member' | 'admin';
  /** May use what membership pays for: an admin always, a member while paid or in grace. */
  readonly paid: boolean;
}

/** The club's CpeIdentity entrypoint, as CPE calls it. */
export interface ClubBinding {
  /** The signed-in member, or null when nobody is signed in or their session has ended. */
  member(cookie: string | null): Promise<ClubIdentity | null>;
}

/** What crossed the binding is an identity: the club's answer is checked, not trusted, on the CPE side. */
export const isIdentity = (v: unknown): v is ClubIdentity => {
  if (typeof v !== 'object' || v === null) return false;
  const o = Object.fromEntries(Object.entries(v));
  return typeof o.id === 'number' && typeof o.name === 'string' && typeof o.email === 'string' && (o.role === 'member' || o.role === 'admin') && typeof o.paid === 'boolean';
};
