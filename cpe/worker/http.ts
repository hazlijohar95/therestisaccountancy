import { identify, type ClubIdentity, type CpeEnv } from "./identity.ts";
import * as check from "./validate.ts";
import { split, type Method, type ParamName, type Reply as RouteReply, type RouteKey } from "../src/domain/routes.ts";

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
export async function paidMember(request: Request, env: Pick<CpeEnv, "CLUB">): Promise<ClubIdentity> {
  const who = await identify(request, env);
  if (!who) throw refuse(401, "Sign in to the club first.");
  if (!who.paid) throw refuse(403, "CPE is part of paid membership.");
  return who;
}


/** A club admin, or a refusal. The Studio checks this on every request. */
export async function admin(request: Request, env: Pick<CpeEnv, "CLUB">): Promise<ClubIdentity> {
  const who = await identify(request, env);
  if (!who) throw refuse(401, "Sign in to the club first.");
  if (who.role !== "admin") throw refuse(403, "The Studio is for club admins.");
  return who;
}

/** A route's handler: it must answer with the reply the shared table (src/domain/routes.ts) gives that route. */
export type Handler<K extends RouteKey> = (request: Request, env: CpeEnv, param: (name: ParamName<K>) => string) => Promise<RouteReply<K>>;

export interface Route {
  readonly method: Method;
  readonly pattern: string;
  /** Runs the handler with the path's parameters, or answers null when the path is not this route's. */
  readonly handle: (request: Request, env: CpeEnv, path: string) => Promise<unknown> | null;
}

/** The parameters in `path` by name, if it has the pattern's shape. A segment written :name captures that segment. */
export function match(pattern: string, path: string): Map<string, string> | null {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params = new Map<string, string>();
  for (let i = 0; i < want.length; i++) {
    if (want[i]!.startsWith(":")) params.set(want[i]!.slice(1), decodeURIComponent(got[i]!));
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

/** One row of the route table, served by `handler`. */
export function route<K extends RouteKey>(key: K, handler: Handler<K>): Route {
  const [method, pattern] = split(key);
  return {
    method,
    pattern,
    handle(request, env, path) {
      const params = match(pattern, path);
      if (!params) return null;
      return handler(request, env, (name) => {
        const value = params.get(name);
        if (value === undefined) throw new Error(`${key} has no parameter ${name}`);
        return value;
      });
    },
  };
}
