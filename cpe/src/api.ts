import type { ApiError } from "./domain/api.ts";

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
 * Calls the CPE Worker. The response is typed by the caller from the shared contract in domain/api.ts: the server and
 * this app are built from the same types, and this is the one place the JSON boundary is crossed.
 */
export async function api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
    ...init,
  });
  const data: unknown = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new Refused(res.status, isError(data) ? data.error : `The server answered ${res.status}.`);
  return data as T;
}
