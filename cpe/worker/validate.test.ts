import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMytDate } from "../src/domain/calendar.ts";
import * as check from "./validate.ts";

const today = parseMytDate("2026-11-27")!;
const entry = { date: "2026-11-01", title: " Year-end tax seminar ", organiser: "CTIM", activity: "course", minutes: 120, tags: { ethics: 30, tax: 90 } };
const refused = (over: Record<string, unknown>, message: RegExp) => assert.throws(() => check.loggedEntry({ ...entry, ...over }, today), (e) => e instanceof check.Invalid && message.test(e.message));

test("a logged entry is read as whole minutes of a known activity on a real Malaysian day", () => {
  assert.deepEqual(check.loggedEntry(entry, today), { date: "2026-11-01", title: "Year-end tax seminar", organiser: "CTIM", activity: "course", minutes: 120, tags: { ethics: 30, tax: 90 } });
  assert.deepEqual(check.loggedEntry({ ...entry, tags: undefined }, today).tags, {}, "subjects are optional");
  assert.deepEqual(check.loggedEntry({ ...entry, tags: { ethics: 0 } }, today).tags, {}, "a subject of no minutes is not kept");
  assert.equal(check.loggedEntry({ ...entry, date: "2026-11-27" }, today).date, "2026-11-27", "today is allowed");
});

test("a logged entry's minutes are a whole number from 1 to 6000", () => {
  refused({ minutes: 0 }, /minutes must be between 1 and 6000/);
  refused({ minutes: 6001 }, /minutes must be between/);
  refused({ minutes: 90.5 }, /minutes must be a whole number/);
  refused({ minutes: "120" }, /minutes must be a number/);
  assert.equal(check.loggedEntry({ ...entry, minutes: 6000, tags: {} }, today).minutes, 6000);
});

test("a logged entry's subjects are known, whole, non-negative, and no more than the entry", () => {
  refused({ tags: { ethics: 121 } }, /tags must not add up to more/);
  refused({ tags: { ethics: 61, tax: 60 } }, /tags must not add up to more/);
  refused({ tags: { ethics: -1 } }, /tags\.ethics must be between/);
  refused({ tags: { ethics: 1.5 } }, /tags\.ethics must be a whole number/);
  refused({ tags: { golf: 10 } }, /tags\.golf is not a subject/);
  refused({ tags: [30] }, /tags must be an object/);
  assert.deepEqual(check.loggedEntry({ ...entry, tags: { ethics: 120 } }, today).tags, { ethics: 120 }, "all of it may be one subject");
});

test("a logged entry needs a known activity, a real date that has happened, a title and an organiser", () => {
  refused({ activity: "golf" }, /activity is not an activity/);
  refused({ activity: "toString" }, /activity is not an activity/);
  refused({ date: "2026-02-30" }, /date must be a date/);
  refused({ date: "2026-11-28" }, /date must not be in the future/);
  refused({ title: " " }, /title must not be empty/);
  refused({ organiser: "" }, /organiser must not be empty/);
});

test("a profile keeps one exemption a year, and a reduced target of at least a minute", () => {
  const profile = { admitted: null, approvedAuditor: false, exemptions: [], miaNumber: null };
  assert.deepEqual(check.profile(profile), profile);
  assert.deepEqual(check.profile({ ...profile, admitted: "", miaNumber: "" }), profile, "blank fields are none");
  const bad = (over: Record<string, unknown>, message: RegExp) => assert.throws(() => check.profile({ ...profile, ...over }), (e) => e instanceof check.Invalid && message.test(e.message));
  bad({ admitted: "2026-06-31" }, /admitted must be a date/);
  bad({ approvedAuditor: "yes" }, /approvedAuditor must be true or false/);
  bad({ exemptions: [{ year: 2026, scope: "full" }, { year: 2026, scope: { structuredMinutes: 600 } }] }, /one exemption a year/);
  bad({ exemptions: [{ year: 2026, scope: { structuredMinutes: 0 } }] }, /structuredMinutes must be between 1 and 1200/);
  bad({ exemptions: [{ year: 2026, scope: "half" }] }, /scope must be an object/);
  bad({ miaNumber: "1".repeat(21) }, /miaNumber must be at most 20/);
});

test("a transcript segment may name its subject, and only a known one", () => {
  const course = { id: "c", showId: "s", title: "T", dek: "D", field: "Ethics", level: "Basic", credits: 1, motif: "grid", published: "2026-11-01", objectives: [], glossary: [], checkpoints: [], quiz: [] };
  const read = (tag: unknown) => check.script({ ...course, segments: [{ speaker: "Host", text: "Hello", tag }] }).segments[0];
  assert.deepEqual(read("tax"), { speaker: "Host", text: "Hello", tag: "tax" });
  assert.deepEqual(read(undefined), { speaker: "Host", text: "Hello" });
  assert.deepEqual(read(""), { speaker: "Host", text: "Hello" }, "blank is the course's default");
  assert.throws(() => read("golf"), check.Invalid);
});
