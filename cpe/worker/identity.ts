/**
 * Who is signed in comes from the club, always. CPE forwards the browser's cookie over a service binding to the club
 * Worker's CpeIdentity entrypoint (app/src/server.ts) and never reads the session itself.
 */

export interface ClubIdentity {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: "member" | "admin";
  /** Paid membership, or an admin. */
  readonly paid: boolean;
}

/** The club's entrypoint, as this Worker calls it. */
export interface ClubBinding {
  member(cookie: string | null): Promise<ClubIdentity | null>;
}

export interface CpeEnv {
  ASSETS: Fetcher;
  CLUB: ClubBinding;
  /** Course audio uploaded in the Studio. */
  AUDIO: R2Bucket;
  /** The club's address, for sign-in and payment links. */
  CLUB_URL: string;
  /** Optional. With it, the Studio can time a transcript against its audio with ElevenLabs forced alignment. */
  ELEVENLABS_API_KEY?: string;
}

export const isIdentity = (v: unknown): v is ClubIdentity => {
  if (typeof v !== "object" || v === null) return false;
  const o = Object.fromEntries(Object.entries(v));
  return typeof o.id === "number" && typeof o.name === "string" && typeof o.email === "string" && (o.role === "member" || o.role === "admin") && typeof o.paid === "boolean";
};

/*
 * A signed-in identity is kept for a short while in this isolate, keyed by a hash of the cookie, so the heard report
 * each listener sends every few seconds does not open the club's database each time. The cost: a suspension, sign-out
 * or lapsed payment reaches CPE within IDENTITY_TTL_MS. Signed-out answers are never kept, so signing in shows at once.
 */
export const IDENTITY_TTL_MS = 60_000;
const IDENTITY_CACHE_MAX = 1000;
const known = new Map<string, { who: ClubIdentity; at: number }>();

async function cookieKey(cookie: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cookie));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function identify(request: Request, env: Pick<CpeEnv, "CLUB">, now: () => number = Date.now): Promise<ClubIdentity | null> {
  const cookie = request.headers.get("cookie");
  const key = cookie ? await cookieKey(cookie) : null;
  const hit = key ? known.get(key) : undefined;
  if (hit && now() - hit.at < IDENTITY_TTL_MS) return hit.who;
  const who: unknown = await env.CLUB.member(cookie);
  if (who === null) {
    if (key) known.delete(key);
    return null;
  }
  if (!isIdentity(who)) throw new Error("The club answered with an identity of the wrong shape.");
  if (key) {
    known.delete(key);
    known.set(key, { who, at: now() });
    if (known.size > IDENTITY_CACHE_MAX) known.delete(known.keys().next().value ?? key);
  }
  return who;
}
