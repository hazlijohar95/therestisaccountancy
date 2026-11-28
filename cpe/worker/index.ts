import type { Member } from "../src/domain/api.ts";
import { mytDate } from "../src/domain/calendar.ts";
import { playable } from "../src/domain/courses.ts";
import type { AppState, CourseProgress } from "../src/domain/progress.ts";
import type { Range } from "../src/domain/rules.ts";
import type { Course } from "../src/domain/types.ts";
import { serveAudio } from "./audio.ts";
import type { Published } from "./catalogue.ts";
import { body, match, paidMember, refuse, Reply, route, type Route } from "./http.ts";
import { studio } from "./studio.ts";
import { identify, type ClubIdentity, type CpeEnv } from "./identity.ts";
import { tagMinutes } from "../src/domain/subjects.ts";
import type { Assessed, Legacy } from "./learner.ts";
import { openCatalogue, openLearner } from "./objects.ts";
import { publishedCache } from "./published.ts";
import { seededPermutation } from "./shuffle.ts";
import * as check from "./validate.ts";

export { CatalogueStore, LearnerStore } from "./objects.ts";

/*
 * Workers RPC types turn tuples into plain arrays, so heard ranges come back from the learner store typed as
 * number[]. These rebuild the pairs. The values are the store's own, already checked on the way in.
 */
const pair = (r: readonly number[]): Range => [r[0] ?? 0, r[1] ?? 0];
type Wire<T> = Omit<T, "ranges"> & { ranges: readonly (readonly number[])[] };
const progressOut = (p: Wire<CourseProgress>): CourseProgress => ({ ...p, ranges: p.ranges.map(pair) });
const stateOut = (s: Omit<AppState, "progress"> & { progress: Readonly<Record<string, Wire<CourseProgress>>> }): AppState => ({
  ...s,
  progress: Object.fromEntries(Object.entries(s.progress).map(([id, p]) => [id, progressOut(p)])),
});

const member = (who: ClubIdentity): Member => ({ name: who.name, email: who.email, role: who.role });

/** The order a listener sees a review question's options in: fixed per listener, so reloading never reshuffles. */
const reviewOrder = (memberId: number, courseId: string, version: number, checkpoint: number, n: number) =>
  seededPermutation(n, `${memberId}:${courseId}:${version}:${checkpoint}`);

const toCourse = (p: Published, memberId: number | null): Course =>
  playable(p.script, p.version, p.show, p.audio, p.timing, (i) => {
    const n = p.script.checkpoints[i]!.options.length;
    return memberId === null ? Array.from({ length: n }, (_, k) => k) : reviewOrder(memberId, p.courseId, p.version, i, n);
  });

const assessed = (p: Published): Assessed => ({
  courseId: p.courseId,
  version: p.version,
  duration: p.audio.duration,
  checkpoints: p.script.checkpoints.length,
  quiz: p.script.quiz,
  title: p.script.title,
  provider: p.show.title,
  field: p.script.field,
  level: p.script.level,
  credits: p.script.credits,
  tags: tagMinutes(p.script, p.timing),
});

const published = publishedCache(async (courseId, version) => {
  using catalogue = await openCatalogue();
  return catalogue.published(courseId, version);
});

async function publishedOr404(courseId: string, version: number): Promise<Published> {
  const p = await published.get(courseId, version);
  if (!p) throw refuse(404, "That course version is not published.");
  return p;
}

/** Puts any certificate the member holds that is not yet on the public register there. Idempotent; runs on every session. */
async function registerCertificates(memberId: number): Promise<void> {
  using learner = await openLearner(memberId);
  const pending = await learner.unregistered();
  if (!pending.length) return;
  using catalogue = await openCatalogue();
  for (const c of pending) {
    await catalogue.register({ id: c.id, name: c.name, courseId: c.courseId, version: c.version, title: c.title, field: c.field, level: c.level, credits: c.credits, tags: c.tags, issuedAt: c.issuedAt });
    await learner.markRegistered(c.id);
  }
}

const signInUrl = (env: CpeEnv, request: Request) => {
  const back = new URL(request.headers.get("referer") ?? "/home", request.url);
  return `${env.CLUB_URL}/sign-in?next=${encodeURIComponent(back.origin === new URL(request.url).origin ? back.href : new URL("/home", request.url).href)}`;
};

const routes: Route[] = [
  route("GET /api/session", async (request, env) => {
    const who = await identify(request, env);
    if (!who) return { status: "signed-out", signIn: signInUrl(env, request) };
    if (!who.paid) return { status: "unpaid", member: member(who), pay: `${env.CLUB_URL}/members/pay` };
    await registerCertificates(who.id);
    using learner = await openLearner(who.id);
    let state = stateOut(await learner.snapshot());
    if (!state.learner) {
      await learner.setName(who.name);
      state = { ...state, learner: who.name };
    }
    return { status: "member", member: member(who), state, club: env.CLUB_URL };
  }),
  route("GET /api/catalogue", async (request, env) => {
    const who = await identify(request, env);
    const memberId = who?.paid ? who.id : null;
    using catalogue = await openCatalogue();
    const latest = await catalogue.latest();
    for (const p of latest) published.remember(p);
    let pins: Record<string, number> = {};
    let certified = new Set<string>();
    if (memberId !== null) {
      using learner = await openLearner(memberId);
      pins = await learner.pins();
      certified = new Set((await learner.snapshot()).certificates.map((c) => c.courseId));
    }
    const courses: Course[] = [];
    for (const p of latest) {
      const pin = pins[p.courseId];
      const pinned = pin !== undefined && pin !== p.version && !certified.has(p.courseId) ? await published.get(p.courseId, pin) : null;
      courses.push(toCourse(pinned ?? p, memberId));
    }
    return { shows: await catalogue.shows(), courses };
  }),
  route("POST /api/heard", async (request, env) => {
    const who = await paidMember(request, env);
    const b = await body(request);
    const courseId = check.slug(b.courseId, "courseId");
    const version = check.integerIn(b.version, "version", 1, 1e6);
    const p = await publishedOr404(courseId, version);
    using learner = await openLearner(who.id);
    return progressOut(await learner.heard(courseId, version, p.audio.duration, check.ranges(b.ranges, "ranges"), check.number(b.position, "position", { min: 0 })));
  }),
  route("POST /api/review", async (request, env) => {
    const who = await paidMember(request, env);
    const b = await body(request);
    const courseId = check.slug(b.courseId, "courseId");
    const version = check.integerIn(b.version, "version", 1, 1e6);
    const p = await publishedOr404(courseId, version);
    const index = check.integerIn(b.checkpoint, "checkpoint", 0, p.script.checkpoints.length - 1);
    const cp = p.script.checkpoints[index]!;
    const shown = check.integerIn(b.pick, "pick", 0, cp.options.length - 1);
    const picked = reviewOrder(who.id, courseId, version, index, cp.options.length)[shown];
    if (picked !== cp.answer) return { correct: false };
    using learner = await openLearner(who.id);
    return { correct: true, why: cp.why, progress: progressOut(await learner.answerReview(courseId, version, index)) };
  }),
  route("POST /api/sittings", async (request, env) => {
    const who = await paidMember(request, env);
    const b = await body(request);
    const p = await publishedOr404(check.slug(b.courseId, "courseId"), check.integerIn(b.version, "version", 1, 1e6));
    using learner = await openLearner(who.id);
    const sitting = await learner.sit(assessed(p));
    if (sitting === "not-ready") throw refuse(409, "Hear the whole episode and answer its review questions first.");
    return { id: sitting.id, questions: p.script.quiz.map((q, i) => ({ prompt: q.prompt, options: sitting.orders[i]!.map((n) => q.options[n]!) })) };
  }),
  route("POST /api/sittings/:id", async (request, env, param) => {
    const id = param("id");
    const who = await paidMember(request, env);
    const b = await body(request);
    const p = await publishedOr404(check.slug(b.courseId, "courseId"), check.integerIn(b.version, "version", 1, 1e6));
    const picks = check.list(b.picks, "picks", 50).map((v, i) => (v === null ? null : check.integerIn(v, `picks[${i}]`, 0, 3)));
    using learner = await openLearner(who.id);
    const graded = await learner.submit(check.string(id, "sitting", { max: 40 }), picks, assessed(p));
    if (graded === "no-sitting") throw refuse(404, "That sitting does not exist.");
    if (graded === "submitted") throw refuse(409, "That sitting was already submitted.");
    if (graded === "wrong-length") throw refuse(400, "Answer every question in the sitting.");
    if (graded.certificate) await registerCertificates(who.id);
    return {
      correct: graded.correct,
      total: graded.total,
      passed: graded.passed,
      certificate: graded.certificate,
      review: p.script.quiz.map((q, i) => {
        const picked = graded.results[i]!.picked;
        const reveal = graded.passed;
        return { prompt: q.prompt, options: [...q.options], picked, right: picked === q.answer, answer: reveal ? q.answer : null, why: reveal ? q.why : null };
      }),
      state: stateOut(await learner.snapshot()),
    };
  }),
  route("PUT /api/name", async (request, env) => {
    const who = await paidMember(request, env);
    const b = await body(request);
    using learner = await openLearner(who.id);
    await learner.setName(check.string(b.name, "name", { max: 120 }));
    return stateOut(await learner.snapshot());
  }),
  route("PUT /api/profile", async (request, env) => {
    const who = await paidMember(request, env);
    const b = await body(request);
    using learner = await openLearner(who.id);
    const profile = check.profile(b.profile);
    if (profile.admitted && profile.admitted > mytDate(new Date())) throw new check.Invalid("profile.admitted must not be in the future");
    await learner.setProfile(profile);
    return stateOut(await learner.snapshot());
  }),
  route("POST /api/logged", async (request, env) => {
    const who = await paidMember(request, env);
    const b = await body(request);
    const entry = check.loggedEntry(b, mytDate(new Date()));
    using learner = await openLearner(who.id);
    await learner.log(entry, b.declared === true);
    return stateOut(await learner.snapshot());
  }),
  route("DELETE /api/logged/:id", async (request, env, param) => {
    const id = param("id");
    const who = await paidMember(request, env);
    using learner = await openLearner(who.id);
    await learner.unlog(check.string(id, "id", { max: 40 }));
    return stateOut(await learner.snapshot());
  }),
  route("PUT /api/declared/:id", async (request, env, param) => {
    const id = param("id");
    const who = await paidMember(request, env);
    const b = await body(request);
    if (typeof b.declared !== "boolean") throw new check.Invalid("declared must be true or false");
    using learner = await openLearner(who.id);
    if (!(await learner.setDeclared(check.string(id, "id", { max: 60 }), b.declared))) throw refuse(404, "No entry of yours has that id.");
    return stateOut(await learner.snapshot());
  }),
  route("POST /api/import", async (request, env) => {
    const who = await paidMember(request, env);
    const legacy = await readLegacy(await body(request));
    using learner = await openLearner(who.id);
    await learner.importLegacy(legacy);
    return stateOut(await learner.snapshot());
  }),
  route("GET /api/certificates/:id", async (request, env, param) => {
    const id = param("id");
    const who = await paidMember(request, env);
    using learner = await openLearner(who.id);
    const cert = await learner.certificate(check.string(id, "id", { max: 60 }));
    if (!cert) throw refuse(404, "No certificate of yours has that id.");
    return cert;
  }),
  route("GET /api/verify/:id", async (_request, _env, param) => {
    const id = param("id");
    using catalogue = await openCatalogue();
    const issued = await catalogue.verify(check.string(id, "id", { max: 60 }).toUpperCase());
    if (!issued) throw refuse(404, "No certificate has that id.");
    return { id: issued.id, name: issued.name, title: issued.title, field: issued.field, level: issued.level, credits: issued.credits, tags: issued.tags, issuedAt: issued.issuedAt, version: issued.version };
  }),
  ...studio,
];

/**
 * The prototype's browser record, kept only where every field reads cleanly; anything malformed is dropped. The
 * requirement an old browser may still send is never read.
 */
async function readLegacy(b: Record<string, unknown>): Promise<Legacy> {
  const keep = <T>(items: unknown, read: (v: unknown, i: number) => T): T[] =>
    (Array.isArray(items) ? items : []).flatMap((v, i) => {
      try {
        return [read(v, i)];
      } catch {
        return [];
      }
    });
  using catalogue = await openCatalogue();
  const latest = new Map((await catalogue.latest()).map((p) => [p.courseId, p.version]));
  const learner = typeof b.learner === "string" && b.learner.trim() ? b.learner.trim().slice(0, 120) : undefined;
  return {
    ...(learner ? { learner } : {}),
    logged: keep(b.logged, (v, i) => check.legacyEntry(v, `logged[${i}]`)),
    certificates: keep(b.certificates, (v, i) => {
      const c = check.record(v, `certificates[${i}]`);
      return check.legacyEntry({ ...c, date: typeof c.issuedAt === "string" && !Number.isNaN(Date.parse(c.issuedAt)) ? mytDate(new Date(c.issuedAt)) : c.date }, `certificates[${i}]`);
    }),
    positions: keep(b.positions, (v, i) => {
      const p = check.record(v, `positions[${i}]`);
      const courseId = check.slug(p.courseId, "courseId");
      const version = latest.get(courseId);
      if (version === undefined) throw new check.Invalid("unknown course");
      return { courseId, version, position: check.number(p.position, `positions[${i}].position`, { min: 0, max: 86_400 }) };
    }),
  };
}

/** Cookie-authenticated writes must come from this app's own pages, never another site. */
function sameOrigin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  return origin === null ? request.headers.get("sec-fetch-site") !== "cross-site" : origin === new URL(request.url).origin;
}

async function api(request: Request, env: CpeEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/audio/")) return serveAudio(request, env, url.pathname.slice("/api/audio/".length));
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site requests are refused." }, { status: 403 });
  const allowed: string[] = [];
  for (const r of routes) {
    if (r.method !== request.method) {
      if (match(r.pattern, url.pathname)) allowed.push(r.method);
      continue;
    }
    try {
      const result = r.handle(request, env, url.pathname);
      if (!result) continue;
      return Response.json(await result, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof Reply) return error.response;
      if (error instanceof check.Invalid) return Response.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  return allowed.length ? new Response("Method not allowed", { status: 405, headers: { allow: allowed.join(", ") } }) : Response.json({ error: "Not found" }, { status: 404 });
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    return url.pathname.startsWith("/api/") ? api(request, env) : env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<CpeEnv>;
