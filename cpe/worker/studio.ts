import type { StudioCourse, StudioIndex, UploadStart } from "../src/domain/api.ts";
import { alignerFor } from "./alignment.ts";
import { AUDIO_KEY } from "./audio.ts";
import { publishProblems, type Entry } from "./catalogue.ts";
import { admin, body, refuse, type Route } from "./http.ts";
import type { CpeEnv } from "./identity.ts";
import { openCatalogue } from "./objects.ts";
import { unguessable } from "./shuffle.ts";
import * as check from "./validate.ts";

/** R2 multipart parts: every part but the last must be the same size, at least 5 MiB. */
const PART_SIZE = 8 * 1024 * 1024;
const EXTS = ["m4a", "mp3", "wav", "ogg", "webm", "aac", "flac"] as const;
type AudioExt = (typeof EXTS)[number];
const AUDIO_TYPES: Record<AudioExt, string> = { m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm", aac: "audio/aac", flac: "audio/flac" };

async function courseView(courseId: string, env: CpeEnv): Promise<StudioCourse> {
  using catalogue = await openCatalogue();
  const draft = await catalogue.draft(courseId);
  const summary = (await catalogue.courses()).find((c) => c.id === courseId);
  if (!summary) throw refuse(404, "No such course.");
  const liveVersion = summary.versions.find((v) => v.status === "published")?.version;
  const live = liveVersion === undefined ? null : await catalogue.entry(courseId, liveVersion);
  return { draft, live, problems: draft ? publishProblems(draft) : [], shows: await catalogue.shows(), aligner: alignerFor(env)?.name ?? null };
}

/** The draft's audio as a file, wherever it lives: uploaded to R2, or one of the sample files served as static assets. */
async function audioOf(draft: Entry, env: CpeEnv, request: Request): Promise<Blob> {
  const url = draft.audio?.url;
  if (!url) throw refuse(409, "Upload the audio first.");
  if (url.startsWith("/api/audio/")) {
    const object = await env.AUDIO.get(url.slice("/api/audio/".length));
    if (!object) throw refuse(409, "The draft's audio is missing from storage. Upload it again.");
    return new Blob([await object.arrayBuffer()], { type: object.httpMetadata?.contentType ?? "audio/mp4" });
  }
  const res = await env.ASSETS.fetch(new URL(url, request.url));
  if (!res.ok) throw refuse(409, "The draft's audio could not be read.");
  return res.blob();
}

const uploadKey = (key: unknown) => {
  const k = check.string(key, "key", { max: 200 });
  if (!AUDIO_KEY.test(k)) throw refuse(400, "That is not an upload key.");
  return k;
};

export const studio: Route[] = [
  [
    "GET",
    "/api/studio",
    async (request, env): Promise<StudioIndex> => {
      await admin(request, env);
      using catalogue = await openCatalogue();
      return { courses: await catalogue.courses(), shows: await catalogue.shows(), aligner: alignerFor(env)?.name ?? null };
    },
  ],
  [
    "POST",
    "/api/studio/courses",
    async (request, env): Promise<StudioCourse> => {
      const who = await admin(request, env);
      const script = check.script((await body(request)).script);
      using catalogue = await openCatalogue();
      const created = await catalogue.create(script, who.email);
      if (created === "taken") throw refuse(409, "A course already has that id.");
      if (created === "no-show") throw refuse(400, "Pick one of the shows.");
      return courseView(script.id, env);
    },
  ],
  [
    "GET",
    "/api/studio/courses/:id",
    async (request, env, [id]): Promise<StudioCourse> => {
      await admin(request, env);
      return courseView(check.slug(id, "id"), env);
    },
  ],
  [
    "POST",
    "/api/studio/courses/:id/draft",
    async (request, env, [id]): Promise<StudioCourse> => {
      const who = await admin(request, env);
      const courseId = check.slug(id, "id");
      using catalogue = await openCatalogue();
      if (!(await catalogue.openDraft(courseId, who.email))) throw refuse(404, "No such course.");
      return courseView(courseId, env);
    },
  ],
  [
    "PUT",
    "/api/studio/courses/:id/draft",
    async (request, env, [id]): Promise<StudioCourse> => {
      const who = await admin(request, env);
      const courseId = check.slug(id, "id");
      const b = await body(request);
      const changes = {
        ...(b.script === undefined ? {} : { script: check.script(b.script) }),
        ...(b.audio === undefined ? {} : { audio: b.audio === null ? null : check.audio(b.audio) }),
        ...(b.timing === undefined ? {} : { timing: b.timing === null ? null : check.timing(b.timing) }),
      };
      if (changes.audio && !(changes.audio.url.startsWith("/audio/") || AUDIO_KEY.test(changes.audio.url.slice("/api/audio/".length)))) {
        throw refuse(400, "Audio must be an upload or one of the sample files.");
      }
      using catalogue = await openCatalogue();
      const saved = await catalogue.saveDraft(courseId, changes, who.email);
      if (saved === "no-draft") throw refuse(409, "There is no draft. Start editing first.");
      if (saved === "no-show") throw refuse(400, "Pick one of the shows.");
      return courseView(courseId, env);
    },
  ],
  [
    "DELETE",
    "/api/studio/courses/:id/draft",
    async (request, env, [id]) => {
      await admin(request, env);
      using catalogue = await openCatalogue();
      return { discarded: await catalogue.discardDraft(check.slug(id, "id")) };
    },
  ],
  [
    "POST",
    "/api/studio/courses/:id/publish",
    async (request, env, [id]): Promise<StudioCourse> => {
      const who = await admin(request, env);
      const courseId = check.slug(id, "id");
      using catalogue = await openCatalogue();
      const result = await catalogue.publish(courseId, who.email);
      if (Array.isArray(result)) throw refuse(422, result.join(" "));
      return courseView(courseId, env);
    },
  ],
  [
    "POST",
    "/api/studio/courses/:id/align",
    async (request, env, [id]) => {
      await admin(request, env);
      const aligner = alignerFor(env);
      if (!aligner) throw refuse(501, "Automatic alignment is not set up. Set the timings by hand.");
      using catalogue = await openCatalogue();
      const draft = await catalogue.draft(check.slug(id, "id"));
      if (!draft?.audio) throw refuse(409, "Upload the audio first.");
      if (!draft.script.segments.length) throw refuse(409, "Add the transcript first.");
      try {
        return await aligner.align(await audioOf(draft, env, request), draft.script.segments.map((s) => s.text), draft.audio.duration);
      } catch (error) {
        throw refuse(502, error instanceof Error ? error.message : "Alignment failed.");
      }
    },
  ],

  /*
   * Audio uploads go through this Worker into R2 as a multipart upload, in parts of PART_SIZE, so a long episode never
   * has to fit in one request. The browser measures duration and peaks itself before uploading.
   */
  [
    "POST",
    "/api/studio/uploads",
    async (request, env): Promise<UploadStart> => {
      await admin(request, env);
      const b = await body(request);
      const courseId = check.slug(b.courseId, "courseId");
      const ext = check.oneOf(String(b.ext ?? "").toLowerCase(), "ext", EXTS);
      const key = `courses/${courseId}/${unguessable(16)}.${ext}`;
      const upload = await env.AUDIO.createMultipartUpload(key, { httpMetadata: { contentType: AUDIO_TYPES[ext] } });
      return { key, uploadId: upload.uploadId, partSize: PART_SIZE };
    },
  ],
  [
    "PUT",
    "/api/studio/uploads/:uploadId/:part",
    async (request, env, [uploadId, part]) => {
      await admin(request, env);
      const key = uploadKey(new URL(request.url).searchParams.get("key"));
      const partNumber = check.integerIn(Number(part), "part", 1, 10_000);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > PART_SIZE) throw refuse(400, `Each part must be at most ${PART_SIZE} bytes.`);
      const uploaded = await env.AUDIO.resumeMultipartUpload(key, check.string(uploadId, "uploadId", { max: 1000 })).uploadPart(partNumber, bytes);
      return { partNumber: uploaded.partNumber, etag: uploaded.etag };
    },
  ],
  [
    "POST",
    "/api/studio/uploads/:uploadId/complete",
    async (request, env, [uploadId]) => {
      await admin(request, env);
      const b = await body(request);
      const key = uploadKey(b.key);
      const parts = check.list(b.parts, "parts", 10_000).map((p, i) => {
        const r = check.record(p, `parts[${i}]`);
        return { partNumber: check.integerIn(r.partNumber, `parts[${i}].partNumber`, 1, 10_000), etag: check.string(r.etag, `parts[${i}].etag`, { max: 200 }) };
      });
      await env.AUDIO.resumeMultipartUpload(key, check.string(uploadId, "uploadId", { max: 1000 })).complete(parts);
      return { url: `/api/audio/${key}` };
    },
  ],
  [
    "DELETE",
    "/api/studio/uploads/:uploadId",
    async (request, env, [uploadId]) => {
      await admin(request, env);
      const key = uploadKey(new URL(request.url).searchParams.get("key"));
      await env.AUDIO.resumeMultipartUpload(key, check.string(uploadId, "uploadId", { max: 1000 })).abort();
      return { aborted: true };
    },
  ],
];
