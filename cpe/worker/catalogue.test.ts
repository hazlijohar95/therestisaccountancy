import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalogue, publishProblems, seedProblem, type SeedTiming } from "./catalogue.ts";
import { memoryDb } from "./node-db.ts";
import { scripts, shows } from "./seed/catalog.ts";
import timings from "./seed/timings.json" with { type: "json" };
import { seededPermutation } from "./shuffle.ts";

const fresh = () => {
  const c = createCatalogue(memoryDb(), () => new Date("2026-11-26T10:00:00Z"));
  c.seed();
  return c;
};

test("the four sample courses are seeded once, published, with their static audio", () => {
  const c = fresh();
  c.seed();
  const latest = c.latest();
  assert.deepEqual(
    latest.map((p) => [p.courseId, p.version, p.audio.url]),
    [
      ["five-threats", 1, "/audio/five-threats.m4a"],
      ["five-steps-revenue", 1, "/audio/five-steps-revenue.m4a"],
      ["hour-worth", 1, "/audio/hour-worth.m4a"],
      ["generated-evidence", 1, "/audio/generated-evidence.m4a"],
    ],
  );
  for (const p of latest) assert.equal(p.timing.segments.length, p.script.segments.length);
});

test("editing a published course makes a new draft version and leaves the published one as it was", () => {
  const c = fresh();
  const v1 = c.published("five-threats", 1)!;
  const draft = c.openDraft("five-threats", "admin@club.test");
  assert.equal(draft?.version, 2);
  assert.equal(draft?.status, "draft");
  assert.equal(c.openDraft("five-threats", "admin@club.test")?.version, 2, "one draft at a time");

  const saved = c.saveDraft("five-threats", { script: { ...v1.script, title: "Five threats, revised" } }, "admin@club.test");
  assert.ok(typeof saved === "object");
  assert.equal(c.published("five-threats", 1)?.script.title, "Five threats, one framework");
  assert.equal(c.latest()[0]?.version, 1, "a draft is not live");

  const published = c.publish("five-threats", "admin@club.test");
  assert.ok(!Array.isArray(published));
  assert.equal(published.version, 2);
  assert.equal(c.latest()[0]?.script.title, "Five threats, revised");
  assert.equal(c.published("five-threats", 1)?.script.title, "Five threats, one framework", "version 1 still plays for anyone on it");
  assert.equal(c.draft("five-threats"), null);
});

test("new audio clears timings made for the old audio, and publishing says what is missing", () => {
  const c = fresh();
  c.openDraft("hour-worth", "a");
  c.saveDraft("hour-worth", { audio: { url: "/api/audio/courses/hour-worth/ABCDEFGHJKLMNPQR.m4a", duration: 99, peaks: [0.5] } }, "a");
  const draft = c.draft("hour-worth")!;
  assert.equal(draft.timing, null);
  assert.deepEqual(publishProblems(draft), ["Set when each transcript segment starts."]);
  const refused = c.publish("hour-worth", "a");
  assert.deepEqual(refused, ["Set when each transcript segment starts."]);
});

test("a new course starts as a draft and cannot take an existing id or an unknown show", () => {
  const c = fresh();
  const base = c.published("five-threats", 1)!.script;
  assert.equal(c.create(base, "a"), "taken");
  assert.equal(c.create({ ...base, id: "new-course", showId: "no-such-show" }, "a"), "no-show");
  const created = c.create({ ...base, id: "new-course" }, "a");
  assert.ok(typeof created === "object");
  assert.equal(created.version, 1);
  assert.equal(c.latest().some((p) => p.courseId === "new-course"), false);
  assert.equal(c.discardDraft("new-course"), true);
  assert.equal(c.courses().some((s) => s.id === "new-course"), false, "discarding a course's only draft removes the course");
});

test("the register confirms a certificate once recorded, and only then", () => {
  const c = fresh();
  const cert = { id: "TRIA-FT-20261126-ABCDEFGHJK", name: "Aina", courseId: "five-threats", version: 1, title: "Five threats, one framework", field: "Ethics" as const, level: "Basic" as const, credits: 1, tags: { ethics: 45, tax: 15 }, issuedAt: "2026-11-26T10:00:00.000Z" };
  assert.equal(c.verify(cert.id), null);
  c.register(cert);
  c.register(cert);
  assert.deepEqual(c.verify(cert.id), cert);
});

test("a certificate registered before the register kept subjects reads as its whole credit under its field", () => {
  const db = memoryDb();
  const c = createCatalogue(db);
  db.prepare("INSERT INTO issued (id, name, course_id, version, title, field, level, credits, issued_at) VALUES ('OLD', 'Aina', 'five-threats', 1, 'Five threats', 'Ethics', 'Basic', 1.5, '2026-03-01T02:00:00.000Z')").run();
  assert.deepEqual(c.verify("OLD")?.tags, { ethics: 90 });
});

test("a listener's review option order is a fixed permutation", () => {
  const a = seededPermutation(4, "7:five-threats:1:0");
  assert.deepEqual(seededPermutation(4, "7:five-threats:1:0"), a);
  assert.deepEqual([...a].sort(), [0, 1, 2, 3]);
});

test("every sample course has a timing for each segment of its script", () => {
  const measured: Readonly<Record<string, SeedTiming | undefined>> = timings;
  assert.deepEqual(
    scripts.flatMap((script) => seedProblem(script, measured[script.id]) ?? []),
    [],
  );
});

test("a stale sample is skipped and logged, and a sample already seeded is never checked again", () => {
  const warnings: string[] = [];
  const c = createCatalogue(memoryDb(), () => new Date("2026-11-26T10:00:00Z"), (m) => warnings.push(m));
  c.seed();
  const [first, second] = scripts;
  const stale = { [first!.id]: { duration: 1, segments: [], peaks: [] } };
  const extra = { ...second!, id: "not-rendered-yet" };
  c.seed({ shows, scripts: [first!, extra], timings: stale });
  assert.equal(c.published(first!.id, 1)?.script.title, first!.title, "the seeded course is untouched");
  assert.equal(c.published("not-rendered-yet", 1), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /not-rendered-yet/);
});

test("one unreadable stored version is left out of the listings and logged, not fatal to them", () => {
  const db = memoryDb();
  const warnings: string[] = [];
  const c = createCatalogue(db, () => new Date("2026-11-26T10:00:00Z"), (m) => warnings.push(m));
  c.seed();
  db.prepare("UPDATE versions SET script = ? WHERE course_id = ?").run(JSON.stringify({ title: "an older shape" }), "five-threats");
  assert.deepEqual(
    c.latest().map((p) => p.courseId),
    ["five-steps-revenue", "hour-worth", "generated-evidence"],
  );
  assert.deepEqual(c.courses().find((x) => x.id === "five-threats")?.versions, []);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /version 1 of course "five-threats"/);
  db.prepare("UPDATE versions SET script = ? WHERE course_id = ?").run("not json", "hour-worth");
  assert.equal(c.latest().length, 2);
});

test("when a course's newest version no longer reads, the one before it is listed instead", () => {
  const db = memoryDb();
  const c = createCatalogue(db, () => new Date("2026-11-26T10:00:00Z"), () => {});
  c.seed();
  const v1 = c.published("five-threats", 1)!;
  c.openDraft("five-threats", "admin@club.test");
  c.saveDraft("five-threats", { script: { ...v1.script, title: "Version two" } }, "admin@club.test");
  c.publish("five-threats", "admin@club.test");
  assert.equal(c.latest()[0]?.version, 2);
  db.prepare("UPDATE versions SET script = ? WHERE course_id = ? AND version = 2").run("not json", "five-threats");
  assert.deepEqual(
    c.latest().map((p) => [p.courseId, p.version]),
    [["five-threats", 1], ["five-steps-revenue", 1], ["hour-worth", 1], ["generated-evidence", 1]],
  );
});
