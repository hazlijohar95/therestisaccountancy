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
    const object = await env.AUDIO.get(key, { range: request.headers, onlyIf: request.headers });
    if (!object) throw refuse(404, "No such audio.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "private, max-age=3600");
    if (!("body" in object)) return new Response(null, { status: 304, headers });
    const range = request.headers.has("range") ? object.range : undefined;
    if (!range) {
      headers.set("content-length", String(object.size));
      return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }
    const offset = "suffix" in range ? object.size - range.suffix : (range.offset ?? 0);
    const length = "suffix" in range ? range.suffix : (range.length ?? object.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  } catch (error) {
    if (error instanceof Reply) return error.response;
    throw error;
  }
}
