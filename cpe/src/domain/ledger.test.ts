import assert from "node:assert/strict";
import { test } from "node:test";
import { daysToYearEnd, parseMytDate, type MytDate } from "./calendar.ts";
import { entriesOf, headline, hours, standingOf, structuredOf, toCsv, yearsOf } from "./ledger.ts";
import type { Activity, Tag } from "./mia.ts";
import { defaultProfile, emptyState, type AppState, type Certificate, type LoggedEntry } from "./progress.ts";

const day = (text: string): MytDate => {
  const parsed = parseMytDate(text);
  if (!parsed) throw new Error(`Not a day: ${text}`);
  return parsed;
};
const today = day("2026-11-27");

let next = 0;
const logged = (date: string, hrs: number, activity: Activity = "course", tags: Partial<Record<Tag, number>> = {}): LoggedEntry => ({
  id: `l${++next}`,
  date: day(date),
  title: `Entry ${next}`,
  organiser: "MIA",
  activity,
  minutes: hrs * 60,
  tags: Object.fromEntries(Object.entries(tags).map(([tag, h]) => [tag, h * 60])),
  source: "self-reported",
});
const certificate = (issuedAt: string, over: Partial<Certificate> = {}): Certificate => ({
  id: `TRIA-${++next}`,
  courseId: `course-${next}`,
  version: 1,
  issuedAt,
  name: "Aina",
  correct: 5,
  total: 5,
  title: "Five threats",
  provider: "Stick to Accounting",
  field: "Ethics",
  level: "Basic",
  credits: 1.5,
  tags: { ethics: 30, "auditing-standards": 60 },
  ...over,
});
const state = (over: Partial<AppState>): AppState => ({ ...emptyState, ...over });
/** Two earlier years of 40 structured hours, so only the year under test can fall short. */
const history = [logged("2024-05-01", 40), logged("2025-05-01", 40)];

test("a certificate is an online course of its credited minutes, on the Malaysian day it was issued", () => {
  const cert = certificate("2026-12-31T16:30:00.000Z");
  const [line] = entriesOf(state({ certificates: [cert] }));
  assert.deepEqual(line, {
    id: cert.id,
    date: "2027-01-01",
    minutes: 90,
    activity: "online-course",
    tags: { ethics: 30, "auditing-standards": 60 },
    title: "Five threats",
    organiser: "Stick to Accounting",
    declaredToMia: false,
    source: "earned",
    certificateId: cert.id,
  });
});

test("a logged entry is carried as stored, and the declared set marks either kind", () => {
  const cert = certificate("2026-03-01T02:00:00.000Z");
  const mine = logged("2026-02-01", 2, "agm", { ethics: 1 });
  const other = logged("2026-04-01", 1, "reading");
  const lines = entriesOf(state({ certificates: [cert], logged: [other, mine], declared: [cert.id, mine.id] }));
  assert.deepEqual(lines.map((l) => [l.id, l.declaredToMia]), [[mine.id, true], [cert.id, true], [other.id, false]], "oldest first");
  assert.deepEqual(lines[0], { ...mine, declaredToMia: true });
});

test("the rules read the record through the adapter: tags, activity and declaration all reach the checks", () => {
  const cert = certificate("2026-03-01T02:00:00.000Z");
  const s = state({ certificates: [cert], logged: [...history, logged("2026-06-01", 2, "reading")], profile: { ...defaultProfile, approvedAuditor: true } });
  const standing = standingOf(s, 2026);
  assert.ok(standing.status === "required");
  const have = Object.fromEntries(standing.checks.map((c) => [c.id, c.have]));
  assert.deepEqual(have, { structured: 90, ethics: 30, auditor: 90, "rolling-total": 80 * 60 + 90 + 120, "rolling-structured": 80 * 60 + 90 });
  assert.deepEqual(standing.undeclared, [cert.id], "reading is unstructured, so it is never declared");
  assert.deepEqual(structuredOf(standing), { id: "structured", have: 90, need: 1200, source: "B110.4" });
});

test("the CSV has MIA's portal fields, hours as decimals, and quotes doubled", () => {
  const cert = certificate("2026-03-01T02:00:00.000Z", { title: 'The "five" threats' });
  const csv = toCsv(entriesOf(state({ certificates: [cert], logged: [logged("2026-04-01", 50 / 60, "reading")] }))).split("\n");
  assert.equal(csv[0], '"Date","Title","Organiser","Hours","Kind","Appendix V item","Ethics hours","Certificate"');
  assert.equal(csv[1], `"2026-03-01","The ""five"" threats","Stick to Accounting","1.5","structured","1(i)","0.5","${cert.id}"`);
  assert.match(csv[2]!, /"0\.83","unstructured","2\(a\)","0",""$/);
  assert.equal(hours(90), "1.5");
  assert.equal(hours(120), "2");
});

test("the years on offer are those with entries and the current one, newest first", () => {
  assert.deepEqual(yearsOf(entriesOf(state({ logged: [logged("2024-05-01", 1), logged("2024-06-01", 1)] })), today), [2026, 2024]);
  assert.deepEqual(yearsOf([], today), [2026]);
});

test("days to the portal's deadline are counted on the Malaysian calendar", () => {
  assert.equal(daysToYearEnd(today), 34);
  assert.equal(daysToYearEnd(day("2026-12-31")), 0);
  assert.equal(daysToYearEnd(day("2028-01-01")), 365, "a leap year");
});

const head = (s: AppState, year = 2026, on = today) => headline(standingOf(s, year), year, on);
/** The answer as the ledger sets it: what is left, then the deadline. */
const answer = (s: AppState, year = 2026) => {
  const h = head(s, year);
  return h.deadline ? `${h.title} · ${h.deadline}` : h.title;
};

test("a year that meets every check is covered, by the rules' own verdict", () => {
  const h = head(state({ logged: [...history, logged("2026-03-01", 40, "course", { ethics: 2 })], declared: [] }));
  assert.equal(h.status, "covered");
  assert.equal(h.title, "2026: covered");
  assert.deepEqual(h.notes, ["1 entry is not yet in the MIA portal, which closes for 2026 on 31 December."]);
});

test("what is left is the largest shortfall, not the sum: ethics hours are structured hours too", () => {
  const h = head(state({ logged: [...history, logged("2026-03-01", 16)] }));
  assert.equal(h.status, "short");
  assert.equal(`${h.title} · ${h.deadline}`, "4 hours left, including 2 hours of ethics · 34 days to 31 December");
});

test("only ethics missing reads as ethics hours, and a few minutes short never reads as none", () => {
  assert.equal(answer(state({ logged: [...history, logged("2026-03-01", 20)] })), "2 hours of ethics left · 34 days to 31 December");
  assert.equal(answer(state({ logged: [...history, logged("2026-03-01", 20, "course", { ethics: 1.5 })] })), "30 min of ethics left · 34 days to 31 December");
  assert.equal(answer(state({ logged: [...history, { ...logged("2026-03-01", 20, "course", { ethics: 2 }), minutes: 1198 }] })), "2 min left · 34 days to 31 December");
  assert.equal(answer(state({ logged: [...history, logged("2026-03-01", 18.5, "course", { ethics: 1 })] })), "1 h 30 min left, including 1 hour of ethics · 34 days to 31 December");
});

test("an approved auditor sees what the auditor's 10 hours still need", () => {
  const auditor = { ...defaultProfile, approvedAuditor: true };
  assert.equal(answer(state({ profile: auditor, logged: [...history, logged("2026-03-01", 20, "course", { ethics: 2, isqm: 6 })] })), "2 hours left for your audit licence · 34 days to 31 December");
  assert.equal(answer(state({ profile: auditor, logged: [...history, logged("2026-03-01", 16, "course", { isqm: 7 })] })), "4 hours left, including 2 hours of ethics and 3 hours for your audit licence · 34 days to 31 December");
});

test("a past year is short, not left, and has no deadline", () => {
  const h = head(state({ logged: [logged("2023-05-01", 40), logged("2024-05-01", 40), logged("2025-03-01", 12)] }), 2025);
  assert.equal(h.title, "8 hours short");
  assert.equal(h.deadline, null);
});

test("a year whose own hours are met but whose three-year window is short says so in its own sentence", () => {
  const h = head(state({ logged: [logged("2026-03-01", 20, "course", { ethics: 2 })] }));
  assert.equal(h.status, "short");
  assert.equal(h.title, "2026: this year's hours are met");
  assert.deepEqual(h.notes.slice(0, 2), ["40 hours of structured learning short across 2024–2026.", "100 hours short in all across 2024–2026. Reading and discussion count towards this."]);
});

test("a year MIA does not ask for, and an exempt year, each say so in one sentence", () => {
  const late = head(state({ profile: { ...defaultProfile, admitted: day("2026-07-01") } }));
  assert.deepEqual(late, { status: "not-required", title: "2026: nothing required", deadline: null, notes: ["MIA counts your CPE from 2027, the first year after your admission that it asks for hours."] });
  const exempt = head(state({ profile: { ...defaultProfile, exemptions: [{ year: 2026, scope: "full" }] } }));
  assert.deepEqual(exempt, { status: "exempt", title: "2026: exempt", deadline: null, notes: ["MIA exempted you for this year, so it asks for no hours."] });
});
