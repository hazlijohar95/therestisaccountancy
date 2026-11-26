/**
 * Who is signed in comes from the club, always. CPE forwards the browser's cookie over a service binding to the club
 * Worker's CpeIdentity entrypoint (site/src/worker.ts) and never reads the session itself.
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

const isIdentity = (v: unknown): v is ClubIdentity => {
  if (typeof v !== "object" || v === null) return false;
  const o = Object.fromEntries(Object.entries(v));
  return typeof o.id === "number" && typeof o.name === "string" && typeof o.email === "string" && (o.role === "member" || o.role === "admin") && typeof o.paid === "boolean";
};

export async function identify(request: Request, env: CpeEnv): Promise<ClubIdentity | null> {
  const who: unknown = await env.CLUB.member(request.headers.get("cookie"));
  if (who === null) return null;
  if (!isIdentity(who)) throw new Error("The club answered with an identity of the wrong shape.");
  return who;
}
