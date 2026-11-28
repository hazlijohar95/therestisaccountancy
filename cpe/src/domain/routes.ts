import type { Catalogue, Graded, HeardReport, LegacyImport, ReviewAnswer, Session, Sitting, StudioCourse, StudioIndex, UploadStart, Verified } from "./api.ts";
import type { AppState, Certificate, CourseProgress, LoggedEntry, MemberProfile } from "./progress.ts";
import type { Audio, CourseScript, Timing } from "./types.ts";

/**
 * Every route of the CPE Worker, keyed "METHOD /path", with what the app sends and what comes back. The Worker's
 * handlers are typed from this table (worker/http.ts) and so is the app's api() (src/api.ts), so the two cannot
 * disagree about a reply without failing to compile. A path segment written :name is a parameter. The server still
 * checks every body it receives (worker/validate.ts): `body` here types what the app sends, not what the server trusts.
 */
export interface Routes {
  "GET /api/session": { reply: Session };
  "GET /api/catalogue": { reply: Catalogue };
  "POST /api/heard": { body: HeardReport; reply: CourseProgress };
  "POST /api/review": { body: { courseId: string; version: number; checkpoint: number; pick: number }; reply: ReviewAnswer };
  "POST /api/sittings": { body: { courseId: string; version: number }; reply: Sitting };
  "POST /api/sittings/:id": { body: { courseId: string; version: number; picks: (number | null)[] }; reply: Graded };
  "PUT /api/name": { body: { name: string }; reply: AppState };
  "PUT /api/profile": { body: { profile: MemberProfile }; reply: AppState };
  "POST /api/logged": { body: Omit<LoggedEntry, "id" | "source">; reply: AppState };
  "DELETE /api/logged/:id": { reply: AppState };
  "PUT /api/declared/:id": { body: { declared: boolean }; reply: AppState };
  "POST /api/import": { body: LegacyImport; reply: AppState };
  "GET /api/certificates/:id": { reply: Certificate };
  "GET /api/verify/:id": { reply: Verified };

  /* The Studio, for club admins only. */
  "GET /api/studio": { reply: StudioIndex };
  "POST /api/studio/courses": { body: { script: CourseScript }; reply: StudioCourse };
  "GET /api/studio/courses/:id": { reply: StudioCourse };
  "POST /api/studio/courses/:id/draft": { reply: StudioCourse };
  "PUT /api/studio/courses/:id/draft": { body: { script?: CourseScript; audio?: Audio | null; timing?: Timing | null }; reply: StudioCourse };
  "DELETE /api/studio/courses/:id/draft": { reply: { discarded: boolean } };
  "POST /api/studio/courses/:id/publish": { reply: StudioCourse };
  "POST /api/studio/courses/:id/align": { reply: Timing };
  "POST /api/studio/uploads": { body: { courseId: string; ext: string }; reply: UploadStart };
  "PUT /api/studio/uploads/:uploadId/:part": { body: Blob; query: { key: string }; reply: { partNumber: number; etag: string } };
  "POST /api/studio/uploads/:uploadId/complete": { body: { key: string; parts: { partNumber: number; etag: string }[] }; reply: { url: string } };
  "DELETE /api/studio/uploads/:uploadId": { query: { key: string }; reply: { aborted: boolean } };
}

export type RouteKey = keyof Routes;
export type Method = "GET" | "POST" | "PUT" | "DELETE";

type PathOf<K extends RouteKey> = K extends `${Method} ${infer P}` ? P : never;
type Names<P extends string> = P extends `${string}:${infer N}/${infer Rest}` ? N | Names<Rest> : P extends `${string}:${infer N}` ? N : never;

/** The names of the route's path parameters: "id" for "/api/sittings/:id". */
export type ParamName<K extends RouteKey> = Names<PathOf<K>>;
/** The route's path parameters by name: { id: string } for "/api/sittings/:id". */
export type Params<K extends RouteKey> = Record<ParamName<K>, string>;
export type Reply<K extends RouteKey> = Routes[K]["reply"];
export type Body<K extends RouteKey> = Routes[K] extends { body: infer B } ? B : undefined;
export type Query<K extends RouteKey> = Routes[K] extends { query: infer Q } ? Q : undefined;

/** What a call to the route takes: its parameters, body and query where it has them. */
export type Call<K extends RouteKey> = ([ParamName<K>] extends [never] ? object : { params: Params<K> }) &
  (Body<K> extends undefined ? object : { body: Body<K> }) &
  (Query<K> extends undefined ? object : { query: Query<K> }) & { keepalive?: boolean };

/** "POST /api/sittings/:id" → ["POST", "/api/sittings/:id"]. */
export function split(route: RouteKey): [Method, string] {
  const at = route.indexOf(" ");
  const method = route.slice(0, at);
  if (method !== "GET" && method !== "POST" && method !== "PUT" && method !== "DELETE") throw new Error(`Bad route ${route}`);
  return [method, route.slice(at + 1)];
}

/** A call's parts, read without its route's types: the typed signature of api() has already checked them. */
export interface Parts {
  params?: Readonly<Record<string, string>>;
  body?: unknown;
  query?: Readonly<Record<string, string>>;
  keepalive?: boolean;
}

const isStrings = (v: unknown): v is Readonly<Record<string, string>> =>
  typeof v === "object" && v !== null && Object.values(v).every((x) => typeof x === "string");

/** The parts of a call, read from it as an object. */
export function partsOf(call: object): Parts {
  return {
    ...("params" in call && isStrings(call.params) ? { params: call.params } : {}),
    ...("body" in call ? { body: call.body } : {}),
    ...("query" in call && isStrings(call.query) ? { query: call.query } : {}),
    ...("keepalive" in call && call.keepalive === true ? { keepalive: true } : {}),
  };
}

/** The route's path with its :name segments filled in, and its query appended. */
export function pathOf(pattern: string, parts: Parts): string {
  const path = pattern
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const value = parts.params?.[segment.slice(1)];
      if (value === undefined) throw new Error(`${pattern} needs ${segment}`);
      return encodeURIComponent(value);
    })
    .join("/");
  return parts.query ? `${path}?${new URLSearchParams(parts.query)}` : path;
}
