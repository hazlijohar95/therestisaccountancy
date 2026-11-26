import { paidMember, refuse, Reply } from "./http.ts";
import type { CpeEnv } from "./identity.ts";

/** Studio uploads live under courses/<course>/<random>.<ext>. Nothing else in the bucket is served. */
export const AUDIO_KEY = /^courses\/[a-z0-9-]+\/[A-Z0-9]{16}\.(m4a|mp3|wav|ogg|webm|aac|flac)$/;

/**
 * Streams uploaded course audio to paid members, honouring Range requests with 206 so the player can seek and iOS
 * will play it at all.
 */
export async function serveAudio(request: Request, env: CpeEnv, key: string): Promise<Response> {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    if (!AUDIO_KEY.test(key)) throw refuse(404, "No such audio.");
    await paidMember(request, env);
    const wanted = parseRange(request.headers.get("range"));
    const object = await env.AUDIO.get(key, wanted ? { range: wanted } : { onlyIf: request.headers });
    if (!object) throw refuse(404, "No such audio.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "private, max-age=3600");
    if (!("body" in object)) return new Response(null, { status: 304, headers });
    if (!wanted) {
      headers.set("content-length", String(object.size));
      return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }
    const offset = "suffix" in wanted ? Math.max(0, object.size - wanted.suffix) : wanted.offset;
    const end = "suffix" in wanted ? object.size - 1 : Math.min(object.size - 1, wanted.length === undefined ? object.size - 1 : wanted.offset + wanted.length - 1);
    if (offset >= object.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${object.size}` } });
    headers.set("content-range", `bytes ${offset}-${end}/${object.size}`);
    headers.set("content-length", String(end - offset + 1));
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  } catch (error) {
    if (error instanceof Reply) return error.response;
    throw error;
  }
}

/** A single byte range from a Range header, as R2 takes it. Null for none, or for anything but one simple range. */
export function parseRange(header: string | null): { offset: number; length?: number } | { suffix: number } | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  if (!m[2]) return { offset };
  const last = Number(m[2]);
  return last >= offset ? { offset, length: last - offset + 1 } : null;
}
