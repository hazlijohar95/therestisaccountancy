import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMytDate, type MytDate } from "../src/domain/calendar.ts";
import { entriesOf, toCsv } from "../src/domain/ledger.ts";
import { evaluate } from "../src/domain/mia.ts";
import { defaultProfile, type LoggedEntry } from "../src/domain/progress.ts";
import { acceptHeard, BANK_SECONDS, MAX_RATE, refill, seconds } from "../src/domain/rules.ts";
import { createCatalogue } from "./catalogue.ts";
import { createLearner, MIGRATIONS, type Assessed } from "./learner.ts";
import { migrate, readable } from "./db.ts";
import { memoryDb } from "./node-db.ts";
import * as check from "./validate.ts";

const day = (text: string): MytDate => {
  const parsed = parseMytDate(text);
  if (!parsed) throw new Error(`Not a day: ${text}`);
  return parsed;
};

/** A seminar a member logs by hand: `hours` on `date`, `ethics` hours of it ethics. */
const seminar = (date: string, hours = 2, ethics = 0): Omit<LoggedEntry, "id" | "source"> => ({
  date: day(date),
  title: "Seminar",
  organiser: "Somewhere",
  activity: "course",
  minutes: hours * 60,
  tags: ethics ? { ethics: ethics * 60 } : {},
});

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
    tags: { ethics: 40, tax: 20 },
  };
  const tick = (seconds: number) => (clock += seconds * 1000);
  /** Hears the course, answers its review questions and passes its assessment. */
  const certify = () => {
    listenAll();
    answerAll();
    learner.setName("Aina Rahman");
    const sitting = learner.sit(course);
    assert.ok(sitting !== "not-ready");
    const graded = learner.submit(sitting.id, course.quiz.map((q, i) => sitting.orders[i]!.indexOf(q.answer)), course);
    assert.ok(typeof graded === "object" && graded.certificate);
    return graded.certificate;
  };
  /** Plays the whole episode at 1x, reporting every 5 seconds of real time, as the app does. */
  const listenAll = () => {
    for (let t = 5; t < course.duration + 5; t += 5) {
      tick(5);
      learner.heard(course.courseId, course.version, course.duration, [[0, Math.min(t, course.duration)]], t);
    }
  };
  const answerAll = () => course.quiz.length && Array.from({ length: course.checkpoints }, (_, i) => learner.answerReview(course.courseId, course.version, i));
  return { learner, course, tick, listenAll, answerAll, certify, catalogue };
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

test("slivers reported a hair apart never fill the gaps between them", () => {
  const w = world();
  w.learner.heard(w.course.courseId, w.course.version, w.course.duration, [], 0);
  let last = w.learner.heard(w.course.courseId, w.course.version, w.course.duration, [], 0);
  // 0.01 s pieces 0.26 s apart, one per report: only the pieces themselves may count.
  for (let i = 0; i < 40; i++) {
    w.tick(1);
    last = w.learner.heard(w.course.courseId, w.course.version, w.course.duration, [[i * 0.26, i * 0.26 + 0.01]], 0);
  }
  assert.ok(Math.abs(seconds(last.ranges) - 40 * 0.01) < 1e-9, `credited ${seconds(last.ranges)} s for 0.4 s of pieces`);
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

test("importing the prototype's record twice adds nothing the second time, nothing becomes a certificate, and its requirement is ignored", () => {
  const w = world();
  const legacy = {
    learner: "Aina",
    requirement: { start: "2026-01-01", end: "2026-12-31", target: 20, minimums: { Ethics: 2 } },
    logged: [check.legacyEntry({ id: "a1", date: "2026-03-01", title: "Tax update", provider: "MIA", field: "Taxation", hours: 2 }, "logged")],
    certificates: [check.legacyEntry({ id: "TRIA-FT-20260301-AB12", date: "2026-03-02", title: "Five threats, one framework", provider: "Stick to Accounting", field: "Ethics", hours: 1 }, "certificate")],
    positions: [{ courseId: w.course.courseId, version: 1, position: 42 }],
  };
  w.learner.importLegacy(legacy);
  w.learner.importLegacy(legacy);
  const s = w.learner.snapshot();
  assert.equal(s.learner, "Aina");
  assert.deepEqual(s.profile, defaultProfile, "the prototype's requirement is not MIA's and is never stored");
  assert.deepEqual(
    s.logged.map((l) => [l.title, l.organiser, l.source, l.activity, l.minutes, l.tags]),
    [
      ["Tax update", "MIA", "self-reported", "course", 120, { tax: 120 }],
      ["Five threats, one framework", "Stick to Accounting", "unverified", "course", 60, { ethics: 60 }],
    ],
  );
  assert.equal(s.certificates.length, 0, "an old browser certificate is never a verified one");
  const p = s.progress[w.course.courseId]!;
  assert.equal(p.position, 42);
  assert.deepEqual(p.ranges, [], "listening evidence is not imported");
});

test("a record from before MIA's model comes across whole: hours as minutes under the field's subject, sources and import keys kept", () => {
  const db = memoryDb();
  migrate(db, MIGRATIONS.slice(0, 1));
  db.prepare("UPDATE learner SET name = 'Aina', requirement = ? WHERE id = 1").run(JSON.stringify({ start: "2026-01-01", end: "2026-12-31", target: 40, minimums: {} }));
  const old = db.prepare("INSERT INTO logged (id, date, title, provider, field, hours, source, legacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  old.run("l1", "2026-02-01", "Ethics briefing", "MIA", "Ethics", 1.5, "self-reported", null, "2026-02-01T01:00:00.000Z");
  old.run("l2", "2026-02-02", "Audit update", "MICPA", "Auditing", 0.1, "self-reported", "logged:a1", "2026-02-02T01:00:00.000Z");
  old.run("l3", "2026-02-03", "IFRS 18", "ACCA", "Accounting", 2, "unverified", "certificate:c1", "2026-02-03T01:00:00.000Z");
  old.run("l4", "2026-02-04", "Budget", "CTIM", "Taxation", 3, "self-reported", null, "2026-02-04T01:00:00.000Z");
  old.run("l5", "2026-02-05", "Fees", "Firm", "Practice Management", 1, "self-reported", null, "2026-02-05T01:00:00.000Z");
  db.prepare("INSERT INTO certificates (id, course_id, version, issued_at, name, correct, total, title, provider, field, level, credits) VALUES ('C1', 'five-threats', 1, '2026-03-01T02:00:00.000Z', 'Aina', 5, 5, 'Five threats', 'Stick to Accounting', 'Ethics', 'Basic', 1.5)").run();

  const learner = createLearner(db, () => new Date("2026-11-26T10:00:00Z"), () => assert.fail("every old row reads"));
  const s = learner.snapshot();
  assert.deepEqual(
    s.logged.map((l) => [l.id, l.organiser, l.activity, l.minutes, l.tags, l.source]),
    [
      ["l1", "MIA", "course", 90, { ethics: 90 }, "self-reported"],
      ["l2", "MICPA", "course", 6, { "auditing-standards": 6 }, "self-reported"],
      ["l3", "ACCA", "course", 120, { "accounting-standards": 120 }, "unverified"],
      ["l4", "CTIM", "course", 180, { tax: 180 }, "self-reported"],
      ["l5", "Firm", "course", 60, { practice: 60 }, "self-reported"],
    ],
  );
  assert.deepEqual(s.certificates[0]?.tags, { ethics: 90 }, "a certificate issued before subjects is its whole credit under its field");
  assert.deepEqual(s.profile, defaultProfile);
  assert.deepEqual(s.declared, []);

  learner.importLegacy({ logged: [check.legacyEntry({ id: "a1", date: "2026-02-02", title: "Audit update", provider: "MICPA", field: "Auditing", hours: 0.1 }, "logged")], certificates: [], positions: [] });
  assert.equal(learner.snapshot().logged.length, 5, "an entry imported before the change is not imported again after it");
});

test("a certificate carries the course's minutes per subject, fixed when issued", () => {
  const w = world();
  const certificate = w.certify();
  assert.deepEqual(certificate.tags, { ethics: 40, tax: 20 });
  assert.deepEqual(w.learner.snapshot().certificates[0]?.tags, { ethics: 40, tax: 20 });
  assert.deepEqual(w.learner.certificate(certificate.id)?.tags, { ethics: 40, tax: 20 });
});

test("the profile is MIA's ordinary member until saved, and is read back as saved", () => {
  const w = world();
  assert.deepEqual(w.learner.snapshot().profile, defaultProfile);
  const profile = check.profile({ admitted: "2026-06-30", approvedAuditor: true, exemptions: [{ year: 2027, scope: "full" }, { year: 2028, scope: { structuredMinutes: 600 } }], miaNumber: " 12345 " });
  w.learner.setProfile(profile);
  assert.deepEqual(w.learner.snapshot().profile, {
    admitted: "2026-06-30",
    approvedAuditor: true,
    exemptions: [{ year: 2027, scope: "full" }, { year: 2028, scope: { structuredMinutes: 600 } }],
    miaNumber: "12345",
  });
});

test("an entry is ticked as entered in the MIA portal by id, certificate or logged, and the tick goes with a removed entry", () => {
  const w = world();
  const certificate = w.certify();
  const logged = w.learner.log(seminar("2026-11-01"));
  assert.equal(w.learner.setDeclared("nope", true), false, "an id that is neither is refused");
  assert.equal(w.learner.setDeclared(certificate.id, true), true);
  assert.equal(w.learner.setDeclared(certificate.id, true), true, "ticking twice changes nothing");
  assert.equal(w.learner.setDeclared(logged.id, true), true);
  assert.deepEqual([...w.learner.snapshot().declared].sort(), [certificate.id, logged.id].sort());

  const state = w.learner.snapshot();
  const standing = evaluate(entriesOf(state), state.profile, 2026);
  assert.ok(standing.status === "required");
  assert.deepEqual(standing.undeclared, [], "the rules see both as declared");

  assert.equal(w.learner.unlog(certificate.id), false, "a certificate is not an entry to remove");
  assert.equal(w.learner.unlog(logged.id), true);
  assert.deepEqual(w.learner.snapshot().declared, [certificate.id], "the removed entry's tick goes; the certificate's stays");
  assert.equal(w.learner.setDeclared(certificate.id, false), true);
  assert.deepEqual(w.learner.snapshot().declared, []);
});

test("the ledger and its CSV read straight from the server's record, in date order", () => {
  const w = world();
  const certificate = w.certify();
  w.learner.log({ ...seminar("2026-11-01", 2, 0.5), title: "Tax update" });
  w.learner.importLegacy({ logged: [], certificates: [check.legacyEntry({ id: "OLD-1", date: "2026-10-01", title: "Old course", provider: "Stick to Accounting", field: "Ethics", hours: 1 }, "certificate")], positions: [] });
  const lines = entriesOf(w.learner.snapshot());
  assert.deepEqual(lines.map((l) => l.source), ["unverified", "self-reported", "earned"]);
  const csv = toCsv(lines).split("\n");
  assert.equal(csv[0], '"Date","Title","Organiser","Hours","Kind","Appendix V item","Ethics hours","Certificate"');
  assert.equal(csv[2], '"2026-11-01","Tax update","Somewhere","2","structured","1(a)–(c), (g), (h)","0.5",""');
  assert.equal(csv[3], `"2026-11-26","${w.course.title}","${w.course.provider}","1","structured","1(i)","0.67","${certificate.id}"`);
});

test("an unreadable part of a record is logged and left out, and the rest still loads", () => {
  const db = memoryDb();
  const warnings: string[] = [];
  const learner = createLearner(db, () => new Date("2026-11-26T10:00:00Z"), (m) => warnings.push(m));
  learner.setProfile({ ...defaultProfile, approvedAuditor: true });
  learner.log(seminar("2026-05-01"));
  learner.log(seminar("2026-05-02"));
  learner.importLegacy({ logged: [], certificates: [], positions: [{ courseId: "five-threats", version: 1, position: 30 }] });
  db.prepare("UPDATE learner SET profile = ? WHERE id = 1").run(JSON.stringify({ admitted: 5 }));
  db.prepare("UPDATE listening SET ranges = ?").run("not json");
  db.prepare("UPDATE logged SET tags = ? WHERE date = '2026-05-02'").run(JSON.stringify({ ethics: 999 }));
  const state = learner.snapshot();
  assert.deepEqual(state.profile, defaultProfile, "falls back to MIA's ordinary member");
  assert.deepEqual(state.progress["five-threats"]?.ranges, [], "unreadable ranges count as none heard");
  assert.equal(state.progress["five-threats"]?.position, 30, "the resume position survives");
  assert.equal(state.logged.length, 1, "an entry claiming more ethics than it has minutes is left out");
  assert.equal(warnings.length, 3);
});

test("a listener whose heard ranges no longer read can still report, and the report rewrites them", () => {
  const db = memoryDb();
  let clock = Date.parse("2026-11-26T10:00:00Z");
  const learner = createLearner(db, () => new Date(clock), () => {});
  learner.heard("five-threats", 1, 600, [], 0);
  db.prepare("UPDATE listening SET ranges = ?").run("not json");
  clock += 10_000;
  assert.deepEqual(learner.heard("five-threats", 1, 600, [[0, 10]], 10).ranges, [[0, 10]]);
  assert.deepEqual(learner.snapshot().progress["five-threats"]?.ranges, [[0, 10]]);
});

test("a bug in reading a row is not mistaken for unreadable data", () => {
  const db = memoryDb();
  const learner = createLearner(db, () => new Date("2026-11-26T10:00:00Z"), () => assert.fail("nothing should be skipped"));
  learner.log(seminar("2026-05-01"));
  assert.throws(
    () => readable([{ id: "x" }], () => { throw new TypeError("a bug"); }, () => assert.fail("not a data problem"), () => "row"),
    TypeError,
  );
  assert.equal(learner.snapshot().logged.length, 1);
});
