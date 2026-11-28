import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDay, mytDate, parseMytDate, type MytDate } from "./calendar.ts";
import { evaluate, firstYear, type Activity, type Entry, type Profile, type Standing, type Tag } from "./mia.ts";

const day = (text: string): MytDate => {
  const parsed = parseMytDate(text);
  if (!parsed) throw new Error(`Not a day: ${text}`);
  return parsed;
};

let next = 0;
/** One entry: `hours` of `activity` on `date`, with `tags` in hours. */
const entry = (date: string, hours: number, activity: Activity = "online-course", tags: Partial<Record<Tag, number>> = {}, over: Partial<Entry> = {}): Entry => ({
  id: `e${++next}`,
  date: day(date),
  minutes: hours * 60,
  activity,
  tags: Object.fromEntries(Object.entries(tags).map(([tag, h]) => [tag, h * 60])),
  title: `Entry ${next}`,
  declaredToMia: true,
  ...over,
});

const member: Profile = { admitted: null, approvedAuditor: false, exemptions: [] };

/** A year of 40 structured hours, 2 of them ethics: three of these meet every check. */
const fullYear = (year: number) => [entry(`${year}-03-01`, 38), entry(`${year}-04-01`, 2, "online-course", { ethics: 2 })];

function required(s: Standing) {
  assert.equal(s.status, "required");
  if (s.status !== "required") throw new Error("unreachable");
  return s;
}

/** Each check's shortfall in hours, leaving out the checks that are met. */
const short = (s: Standing): Record<string, number> =>
  Object.fromEntries(required(s).checks.filter((c) => c.have < c.need).map((c) => [c.id, (c.need - c.have) / 60]));

test("a member admitted by 30 June starts CPE that year, in full", () => {
  const admitted = { ...member, admitted: day("2026-06-30") };
  assert.equal(firstYear(admitted), 2026);
  assert.deepEqual(short(evaluate([], admitted, 2026)), { structured: 20, ethics: 2, "rolling-total": 40, "rolling-structured": 20 });
});

test("a member admitted from 1 July starts the next year", () => {
  const admitted = { ...member, admitted: day("2026-07-01") };
  assert.deepEqual(evaluate([], admitted, 2026), { status: "not-required", from: 2027 });
  assert.equal(required(evaluate([], admitted, 2027)).met, false);
});

test("ethics is required from 2026, not before", () => {
  const without = [entry("2025-05-01", 40)];
  assert.deepEqual(short(evaluate([...fullYear(2023), ...fullYear(2024), ...without], member, 2025)), {});
  const in2026 = [entry("2026-05-01", 40)];
  assert.deepEqual(short(evaluate([...fullYear(2024), ...fullYear(2025), ...in2026], member, 2026)), { ethics: 2 });
});

test("the ethics part of a broader course counts towards ethics and the year alike", () => {
  const s = required(evaluate([entry("2026-05-01", 1.5, "online-course", { ethics: 0.5 })], { ...member, admitted: day("2026-01-10") }, 2026));
  assert.deepEqual(
    s.checks.filter((c) => c.id === "structured" || c.id === "ethics").map((c) => [c.id, c.have / 60]),
    [["structured", 1.5], ["ethics", 0.5]],
  );
});

test("extra structured hours never carry into the next year, but still count in the window", () => {
  const entries = [...fullYear(2025), entry("2026-02-01", 68, "online-course", { ethics: 2 }), entry("2027-02-01", 12, "online-course", { ethics: 2 })];
  assert.deepEqual(short(evaluate(entries, member, 2027)), { structured: 8 });
});

test("the rolling window asks for 120 hours across three years", () => {
  const entries = [entry("2024-02-01", 40), entry("2025-02-01", 40), entry("2026-02-01", 28, "online-course", { ethics: 2 })];
  assert.deepEqual(short(evaluate(entries, member, 2026)), { "rolling-total": 12 });
});

test("structured hours count towards the 120, so nobody needs unstructured hours", () => {
  const entries = [2024, 2025, 2026].map((y) => entry(`${y}-02-01`, 40, "online-course", { ethics: 2 }));
  assert.equal(required(evaluate(entries, member, 2026)).met, true);
});

test("unstructured hours count towards the 120 and nothing else", () => {
  const reading = [2024, 2025, 2026].map((y) => entry(`${y}-06-01`, 20, "reading"));
  const s = evaluate([...fullYear(2024), ...fullYear(2025), ...fullYear(2026), ...reading], member, 2026);
  assert.equal(required(s).met, true);
  assert.deepEqual(short(evaluate([entry("2026-06-01", 120, "reading")], member, 2026)), { structured: 20, ethics: 2, "rolling-structured": 60 });
});

test("one ethics hour counts towards the 2, the 20, the auditor's 10, the 60 and the 120 at once", () => {
  const auditor = { ...member, admitted: day("2026-01-05"), approvedAuditor: true };
  const s = required(evaluate([entry("2026-03-01", 1, "online-course", { ethics: 1 })], auditor, 2026));
  assert.deepEqual(Object.fromEntries(s.checks.map((c) => [c.id, c.have / 60])), {
    structured: 1,
    ethics: 1,
    auditor: 1,
    "rolling-total": 1,
    "rolling-structured": 1,
  });
});

test("an approved auditor needs 10 of the 20 on standards or ethics", () => {
  const auditor = { ...member, approvedAuditor: true };
  const year = [entry("2026-03-01", 12, "online-course", { tax: 12 }), entry("2026-04-01", 8, "online-course", { isqm: 6, ethics: 2 }), entry("2026-06-01", 20, "reading")];
  assert.deepEqual(short(evaluate([...fullYear(2024), ...fullYear(2025), ...year], auditor, 2026)), { auditor: 2 });
});

test("an AGM counts towards the 20 but not towards the auditor's 10", () => {
  const auditor = { ...member, approvedAuditor: true };
  const year = [entry("2026-03-01", 10, "online-course", { "auditing-standards": 8, ethics: 2 }), entry("2026-05-01", 2, "agm", { ethics: 2 }), entry("2026-06-01", 28)];
  assert.deepEqual(short(evaluate([...fullYear(2024), ...fullYear(2025), ...year], auditor, 2026)), {});
  const fewer = [entry("2026-03-01", 8, "online-course", { "auditing-standards": 6, ethics: 2 }), entry("2026-05-01", 2, "agm", { ethics: 2 }), entry("2026-06-01", 30)];
  assert.deepEqual(short(evaluate([...fullYear(2024), ...fullYear(2025), ...fewer], auditor, 2026)), { auditor: 2 });
});

test("lecturing earns at most 10 hours a year, and repeat presentations at most 6 of them", () => {
  const year = [entry("2026-02-01", 8, "lecturing"), entry("2026-03-01", 6, "lecturing"), entry("2026-04-01", 8, "lecturing-repeat")];
  const s = required(evaluate(year, member, 2026));
  assert.equal(s.checks.find((c) => c.id === "structured")!.have / 60, 10);
  assert.deepEqual(
    s.capped.map((c) => [c.claimed / 60, c.credited / 60, c.source]),
    [[6, 2, "Appendix V 1(k)"], [8, 0, "Appendix V 1(k)"]],
  );
});

test("CARE mentoring earns 4 hours a year however it is logged, and never towards the auditor's 10", () => {
  const auditor = { ...member, admitted: day("2026-01-05"), approvedAuditor: true };
  const s = required(evaluate([entry("2026-02-01", 4, "care-mentor", { ethics: 4 }), entry("2026-08-01", 4, "care-mentor", { ethics: 4 })], auditor, 2026));
  assert.equal(s.checks.find((c) => c.id === "structured")!.have / 60, 4);
  assert.equal(s.checks.find((c) => c.id === "auditor")!.have, 0);
});

test("a cap pays the entries that meet a minimum first", () => {
  const year = [entry("2026-02-01", 10, "lecturing", { tax: 10 }), entry("2026-03-01", 2, "lecturing", { ethics: 2 }), entry("2026-04-01", 30)];
  assert.deepEqual(short(evaluate([...fullYear(2024), ...fullYear(2025), ...year], member, 2026)), {});
});

test("negative tag minutes count as none", () => {
  const auditor = { ...member, admitted: day("2026-01-05"), approvedAuditor: true };
  const s = required(evaluate([entry("2026-02-01", 15, "online-course", { isqm: 15, ethics: -5 })], auditor, 2026));
  assert.equal(s.checks.find((c) => c.id === "auditor")!.have / 60, 15);
});

test("a window reaching before the first modelled ruleset is measured by it", () => {
  assert.equal(required(evaluate([2016, 2017, 2018].map((y) => entry(`${y}-02-01`, 40)), member, 2018)).met, true);
});

test("a committee meeting earns at most 2 hours", () => {
  const s = required(evaluate([entry("2026-02-01", 3, "committee")], member, 2026));
  assert.equal(s.checks.find((c) => c.id === "structured")!.have / 60, 2);
});

test("the same standards activity earns at most 10 hours in a window", () => {
  const work = (date: string) => entry(date, 6, "standards", {}, { title: "MPERS exposure draft" });
  const s = required(evaluate([work("2025-02-01"), work("2026-02-01")], member, 2026));
  assert.equal(s.checks.find((c) => c.id === "rolling-structured")!.have / 60, 10);
  assert.equal(s.checks.find((c) => c.id === "structured")!.have / 60, 4);
});

test("a full exemption takes the year out, and out of the window's target", () => {
  const exempt = { ...member, exemptions: [{ year: 2026, scope: "full" as const }] };
  assert.deepEqual(evaluate([], exempt, 2026), { status: "exempt" });
  const around = [...fullYear(2025), entry("2027-02-01", 40, "online-course", { ethics: 2 })];
  assert.deepEqual(short(evaluate(around, exempt, 2027)), {});
  assert.deepEqual(short(evaluate(around, member, 2027)), { "rolling-total": 40 });
});

test("a partial exemption lowers the year's 20 but keeps the 2 hours of ethics", () => {
  const partly = { ...member, exemptions: [{ year: 2026, scope: { structuredMinutes: 600 } }] };
  assert.deepEqual(short(evaluate([...fullYear(2024), ...fullYear(2025), entry("2026-02-01", 10), entry("2026-06-01", 10, "reading")], partly, 2026)), { ethics: 2 });
});

test("a new member's first windows ask for 40 hours a year they were required", () => {
  const admitted = { ...member, admitted: day("2025-03-01") };
  assert.deepEqual(short(evaluate([entry("2025-03-01", 20)], admitted, 2025)), { "rolling-total": 20 });
  assert.deepEqual(short(evaluate([entry("2025-03-01", 40), entry("2026-03-01", 40, "online-course", { ethics: 2 })], admitted, 2026)), {});
});

test("only the year's structured entries not yet in the MIA portal are listed to declare", () => {
  const year = [entry("2026-02-01", 10, "online-course", {}, { declaredToMia: false }), entry("2026-03-01", 10), entry("2026-04-01", 5, "reading", {}, { declaredToMia: false })];
  const s = required(evaluate(year, member, 2026));
  assert.deepEqual(s.undeclared, [year[0]!.id]);
});

test("a completion falls in the Malaysian calendar year", () => {
  assert.equal(mytDate(new Date("2026-12-31T15:59:59Z")), "2026-12-31");
  assert.equal(mytDate(new Date("2026-12-31T16:30:00Z")), "2027-01-01");
  assert.equal(mytDate(new Date("2027-01-01T07:00:00Z")), "2027-01-01");
});

test("a date is a real day, and reads the same wherever the reader is", () => {
  assert.equal(parseMytDate("2026-02-29"), null);
  assert.equal(parseMytDate("2026-2-1"), null);
  assert.equal(parseMytDate("2028-02-29"), "2028-02-29");
  assert.equal(formatDay(day("2027-01-01")), "1 January 2027");
  assert.equal(formatDay(day("2027-01-01"), "short"), "1 Jan 2027");
});
