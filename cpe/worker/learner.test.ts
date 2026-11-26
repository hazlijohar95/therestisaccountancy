import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerLines, toCsv } from "../src/domain/ledger.ts";
import { acceptHeard, BANK_SECONDS, MAX_RATE, refill } from "../src/domain/rules.ts";
import { createCatalogue } from "./catalogue.ts";
import { createLearner, type Assessed } from "./learner.ts";
import { memoryDb } from "./node-db.ts";

/** A learner on a fake clock, and a course built from the first seeded sample. */
function world() {
  let clock = Date.parse("2026-11-26T10:00:00Z");
  const now = () => new Date(clock);
  const learner = createLearner(memoryDb(), now);
  const catalogue = createCatalogue(memoryDb(), now);
  catalogue.seed();
  const p = catalogue.latest()[0]!;
  const course: Assessed = {
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
  };
  const tick = (seconds: number) => (clock += seconds * 1000);
  /** Plays the whole episode at 1x, reporting every 5 seconds of real time, as the app does. */
  const listenAll = () => {
    for (let t = 5; t < course.duration + 5; t += 5) {
      tick(5);
      learner.heard(course.courseId, course.version, course.duration, [[0, Math.min(t, course.duration)]], t);
    }
  };
  const answerAll = () => course.quiz.length && Array.from({ length: course.checkpoints }, (_, i) => learner.answerReview(course.courseId, course.version, i));
  return { learner, course, tick, listenAll, answerAll, catalogue };
}

test("accepted audio never exceeds the budget, and is taken earliest first", () => {
  assert.deepEqual(acceptHeard([], [[0, 100]], 10, 300), { ranges: [[0, 10]], spent: 10 });
  assert.deepEqual(acceptHeard([[0, 10]], [[0, 100]], 10, 300), { ranges: [[0, 20]], spent: 10 }, "only new audio costs anything");
  assert.deepEqual(acceptHeard([[0, 50]], [[0, 50]], 0, 300).ranges, [[0, 50]], "a report never takes audio away");
  assert.deepEqual(acceptHeard([], [[290, 400]], 100, 300), { ranges: [[290, 300]], spent: 10 }, "nothing past the end counts");
  assert.deepEqual(acceptHeard([], [[-5, 5]], 100, 300).ranges, [[0, 5]]);
  assert.deepEqual(acceptHeard([[10, 20]], [[0, 30]], 15, 300).ranges, [[0, 25]], "gaps on both sides are filled in order");
});

test("the bucket fills at the fastest rate and holds at most the bank", () => {
  assert.equal(refill(0, 3), 3 * MAX_RATE);
  assert.equal(refill(0, 3600), BANK_SECONDS * MAX_RATE, "an idle hour banks no more than the cap");
  assert.equal(refill(-4, 1), MAX_RATE, "a negative balance is never carried");
});

test("a listener at 1x gets every second they hear", () => {
  const w = world();
  w.listenAll();
  const p = w.learner.snapshot().progress[w.course.courseId]!;
  assert.deepEqual(p.ranges, [[0, w.course.duration]]);
});

test("a report claiming the whole episode at once gets only what real time allows", () => {
  const w = world();
  w.tick(10);
  const first = w.learner.heard(w.course.courseId, w.course.version, w.course.duration, [[0, w.course.duration]], w.course.duration);
  assert.deepEqual(first.ranges, [], "the first report has no banked time");
  w.tick(10);
  const second = w.learner.heard(w.course.courseId, w.course.version, w.course.duration, [[0, w.course.duration]], w.course.duration);
  assert.deepEqual(second.ranges, [[0, 10 * MAX_RATE]]);
});

test("two courses at once draw on one budget", () => {
  const w = world();
  const other = w.catalogue.latest()[1]!;
  w.learner.heard(w.course.courseId, w.course.version, w.course.duration, [], 0);
  w.tick(10);
  const a = w.learner.heard(w.course.courseId, w.course.version, w.course.duration, [[0, 60]], 60);
  const b = w.learner.heard(other.courseId, other.version, other.audio.duration, [[0, 60]], 60);
  const heard = (r: readonly (readonly [number, number])[]) => r.reduce((s, [x, y]) => s + y - x, 0);
  assert.equal(heard(a.ranges) + heard(b.ranges), 10 * MAX_RATE);
});

test("the assessment opens only after listening and every review question", () => {
  const w = world();
  assert.equal(w.learner.sit(w.course), "not-ready");
  w.listenAll();
  assert.equal(w.learner.sit(w.course), "not-ready", "review questions still unanswered");
  w.answerAll();
  const sitting = w.learner.sit(w.course);
  assert.notEqual(sitting, "not-ready");
});

test("grading maps shuffled positions back, issues one certificate, and never grades a sitting twice", () => {
  const w = world();
  w.listenAll();
  w.answerAll();
  w.learner.setName("Aina Rahman");
  const sitting = w.learner.sit(w.course);
  assert.ok(sitting !== "not-ready");
  for (const order of sitting.orders) assert.deepEqual([...order].sort(), order.map((_, i) => i), "each order is a permutation");
  const rightPicks = w.course.quiz.map((q, i) => sitting.orders[i]!.indexOf(q.answer));
  const graded = w.learner.submit(sitting.id, rightPicks, w.course);
  assert.ok(typeof graded === "object");
  assert.equal(graded.correct, w.course.quiz.length);
  assert.equal(graded.passed, true);
  assert.ok(graded.certificate);
  assert.match(graded.certificate.id, /^TRIA-[A-Z]+-20261126-[A-Z2-9]{10}$/);
  assert.equal(graded.certificate.name, "Aina Rahman");
  assert.equal(w.learner.submit(sitting.id, rightPicks, w.course), "submitted");

  const practice = w.learner.sit(w.course);
  assert.ok(practice !== "not-ready", "a certified course can be retaken for practice");
  const again = w.learner.submit(practice.id, rightPicks.map(() => null), w.course);
  assert.ok(typeof again === "object");
  assert.equal(again.passed, false);
  assert.equal(again.certificate, null);
  assert.equal(w.learner.snapshot().certificates.length, 1, "retakes never post again");
});

test("a failed sitting issues nothing, and a sitting from another course is refused", () => {
  const w = world();
  w.listenAll();
  w.answerAll();
  const sitting = w.learner.sit(w.course);
  assert.ok(sitting !== "not-ready");
  const wrong = w.course.quiz.map((q, i) => sitting.orders[i]!.findIndex((src) => src !== q.answer));
  const graded = w.learner.submit(sitting.id, wrong, w.course);
  assert.ok(typeof graded === "object");
  assert.equal(graded.correct, 0);
  assert.equal(graded.certificate, null);
  assert.equal(w.learner.submit(sitting.id, wrong, { ...w.course, courseId: "other" }), "no-sitting");
  assert.equal(w.learner.submit("nope", wrong, w.course), "no-sitting");
});

test("a listener stays on the version they started when a new one is published", () => {
  const w = world();
  w.learner.heard(w.course.courseId, 1, w.course.duration, [], 12);
  assert.deepEqual(w.learner.pins(), { [w.course.courseId]: 1 });
  w.learner.heard(w.course.courseId, 2, w.course.duration, [], 3);
  assert.equal(w.learner.pins()[w.course.courseId], 2, "evidence on a newer version moves them to it");
});

test("importing the prototype's record twice adds nothing the second time, and nothing becomes a certificate", () => {
  const w = world();
  const legacy = {
    learner: "Aina",
    requirement: { start: "2026-01-01", end: "2026-12-31", target: 20, minimums: { Ethics: 2 } },
    logged: [{ id: "a1", date: "2026-03-01", title: "Tax update", provider: "MIA", field: "Taxation" as const, hours: 2 }],
    certificates: [{ id: "TRIA-FT-20260301-AB12", date: "2026-03-02", title: "Five threats, one framework", provider: "Stick to Accounting", field: "Ethics" as const, hours: 1 }],
    positions: [{ courseId: w.course.courseId, version: 1, position: 42 }],
  };
  w.learner.importLegacy(legacy);
  w.learner.importLegacy(legacy);
  const s = w.learner.snapshot();
  assert.equal(s.learner, "Aina");
  assert.equal(s.requirement.target, 20);
  assert.deepEqual(
    s.logged.map((l) => [l.title, l.source]),
    [
      ["Tax update", "self-reported"],
      ["Five threats, one framework", "unverified"],
    ],
  );
  assert.equal(s.certificates.length, 0, "an old browser certificate is never a verified one");
  const p = s.progress[w.course.courseId]!;
  assert.equal(p.position, 42);
  assert.deepEqual(p.ranges, [], "listening evidence is not imported");
});

test("the ledger and its CSV read straight from the server's record, with each line's source", () => {
  const w = world();
  w.listenAll();
  w.answerAll();
  w.learner.setName("Aina Rahman");
  const sitting = w.learner.sit(w.course);
  assert.ok(sitting !== "not-ready");
  const graded = w.learner.submit(sitting.id, w.course.quiz.map((q, i) => sitting.orders[i]!.indexOf(q.answer)), w.course);
  assert.ok(typeof graded === "object" && graded.certificate);
  w.learner.log({ date: "2026-11-01", title: "Tax update", provider: "Self-reported", field: "Taxation", hours: 2 });
  w.learner.importLegacy({ logged: [], certificates: [{ id: "OLD-1", date: "2026-10-01", title: "Old course", provider: "Stick to Accounting", field: "Ethics", hours: 1 }], positions: [] });
  const csv = toCsv(ledgerLines(w.learner.snapshot())).split("\n");
  assert.equal(csv[0], '"Date","Title","Provider","Field of study","Hours","Source","Certificate"');
  const source = (row: string) => ["earned", "self-reported", "unverified"].find((x) => row.includes(`,"${x}",`));
  assert.deepEqual(csv.slice(1).map(source), ["unverified", "self-reported", "earned"], "in date order");
  assert.ok(csv[3]!.endsWith(`"${graded.certificate.id}"`), "an earned line carries its certificate id");
});
