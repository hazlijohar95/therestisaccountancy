import type { ApiError } from "./domain/api.ts";
import { partsOf, pathOf, split, type Call, type Reply, type RouteKey } from "./domain/routes.ts";

/** A refusal from the CPE Worker, with its status: 401 signed out, 403 unpaid or not an admin, 409 not ready, and so on. */
export class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const isError = (v: unknown): v is ApiError => typeof v === "object" && v !== null && "error" in v && typeof v.error === "string";

/**
 * Calls one route of the CPE Worker. The method, path parameters, body and reply all come from the route table the
 * Worker's handlers are compiled against (domain/routes.ts), so a caller cannot ask for a reply the route does not give.
 * A Blob body is sent as bytes; any other body as JSON.
 */
export async function api<K extends RouteKey>(route: K, ...[call]: object extends Call<K> ? [call?: Call<K>] : [call: Call<K>]): Promise<Reply<K>> {
  const [method, pattern] = split(route);
  const parts = partsOf(call ?? {});
  const raw = parts.body instanceof Blob;
  const res = await fetch(pathOf(pattern, parts), {
    method,
    credentials: "same-origin",
    headers: parts.body === undefined || raw ? {} : { "content-type": "application/json" },
    body: parts.body === undefined ? null : parts.body instanceof Blob ? parts.body : JSON.stringify(parts.body),
    keepalive: parts.keepalive ?? false,
  });
  const data: unknown = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new Refused(res.status, isError(data) ? data.error : `The server answered ${res.status}.`);
  // The one unchecked step: JSON off the wire is trusted to be the reply this route's handler is typed to return.
  // Checking it would need a validator for every reply type; the server is built from the same table instead.
  return data as Reply<K>;
}
