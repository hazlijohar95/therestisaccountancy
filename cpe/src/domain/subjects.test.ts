import assert from "node:assert/strict";
import { test } from "node:test";
import { tagMinutes } from "./subjects.ts";
import type { Segment, Timing } from "./types.ts";

const seg = (tag?: Segment["tag"]): Segment => ({ speaker: "Host", text: "…", ...(tag ? { tag } : {}) });
/** Timings for segments of these lengths in seconds, laid end to end. */
const timed = (...lengths: number[]): Timing => {
  let at = 0;
  const segments = lengths.map((length) => ({ start: at, end: (at += length) }));
  return { duration: at, segments };
};
const total = (tags: Readonly<Partial<Record<string, number>>>) => Object.values(tags).reduce<number>((sum, n) => sum + (n ?? 0), 0);

test("a course with no tagged segment carries its whole credit under its field's subject", () => {
  assert.deepEqual(tagMinutes({ field: "Taxation", credits: 1.5, segments: [seg(), seg()] }, timed(100, 200)), { tax: 90 });
  assert.deepEqual(tagMinutes({ field: "Ethics", credits: 1, segments: [seg()] }, timed(300)), { ethics: 60 });
});

test("a tagged segment moves its share of the audio, and so of the credit, to its subject", () => {
  const tags = tagMinutes({ field: "Auditing", credits: 1.5, segments: [seg(), seg("ethics"), seg()] }, timed(200, 100, 0));
  assert.deepEqual(tags, { ethics: 30, "auditing-standards": 60 }, "a third of the audio is a third of the 90 minutes");
});

test("the parts are whole minutes that sum to the credited minutes, however the audio divides", () => {
  const thirds = tagMinutes({ field: "Accounting", credits: 1, segments: [seg("ethics"), seg("tax"), seg()] }, timed(1, 1, 1));
  assert.deepEqual(thirds, { ethics: 20, "accounting-standards": 20, tax: 20 });
  const uneven = tagMinutes({ field: "Accounting", credits: 0.5, segments: [seg("ethics"), seg("isqm"), seg("tax"), seg()] }, timed(7, 7, 7, 1));
  assert.equal(total(uneven), 30);
  assert.ok(Object.values(uneven).every((n) => Number.isInteger(n) && n > 0));
  for (const credits of [0.5, 1, 1.5, 2] as const) {
    const tags = tagMinutes({ field: "Ethics", credits, segments: [seg(), seg("tax"), seg("isqm"), seg("technology"), seg("other")] }, timed(13.7, 211.2, 0.4, 97.9, 45.1));
    assert.equal(total(tags), credits * 60, `${credits} credits`);
  }
});

test("a subject too small to earn a minute is left out, and the credit still sums", () => {
  const tags = tagMinutes({ field: "Taxation", credits: 0.5, segments: [seg("ethics"), seg()] }, timed(1, 3000));
  assert.deepEqual(tags, { tax: 30 });
});

test("without timings, or with timings for another transcript, the whole credit sits under the field's subject", () => {
  const script = { field: "Practice Management" as const, credits: 2 as const, segments: [seg("ethics"), seg()] };
  assert.deepEqual(tagMinutes(script, null), { practice: 120 });
  assert.deepEqual(tagMinutes(script, timed(60)), { practice: 120 });
  assert.deepEqual(tagMinutes(script, timed(0, 0)), { practice: 120 });
});
