import { identify, type ClubIdentity, type CpeEnv } from "./identity.ts";
import * as check from "./validate.ts";

/** A response the router returns as is: refusals, and results that are not JSON. */
export class Reply extends Error {
  readonly response: Response;
  constructor(response: Response) {
    super(`HTTP ${response.status}`);
    this.response = response;
  }
}

export const refuse = (status: number, error: string) => new Reply(Response.json({ error }, { status, headers: { "cache-control": "no-store" } }));

export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw refuse(415, "Send JSON.");
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw refuse(400, "The body is not valid JSON.");
  }
  return check.record(parsed, "body");
}

/** A signed-in member with paid access, or a refusal the app turns into the right sign-in or membership state. */
export async function paidMember(request: Request, env: CpeEnv): Promise<ClubIdentity> {
  const who = await identify(request, env);
  if (!who) throw refuse(401, "Sign in to the club first.");
  if (!who.paid) throw refuse(403, "CPE is part of paid membership.");
  return who;
}


/** A club admin, or a refusal. The Studio checks this on every request. */
export async function admin(request: Request, env: CpeEnv): Promise<ClubIdentity> {
  const who = await identify(request, env);
  if (!who) throw refuse(401, "Sign in to the club first.");
  if (who.role !== "admin") throw refuse(403, "The Studio is for club admins.");
  return who;
}

export type Handler = (request: Request, env: CpeEnv, params: string[]) => Promise<unknown>;

/** [method, path, handler]. A path segment written :x captures that segment. */
export type Route = [string, string, Handler];
