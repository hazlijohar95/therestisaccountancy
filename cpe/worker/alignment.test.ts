import assert from "node:assert/strict";
import { test } from "node:test";
import { segmentStarts } from "./alignment.ts";

const words = (text: string, from = 0, step = 0.5) => text.split(" ").map((t, i) => ({ text: t, start: from + i * step, end: from + i * step + 0.4 }));

test("each segment starts at its first aligned word, and ends where the next starts", () => {
  const timing = segmentStarts(["Hello there.", "Second line, here.", "Done."], words("Hello there. Second line, here. Done."), 10);
  assert.deepEqual(timing, {
    duration: 10,
    segments: [
      { start: 0, end: 1 },
      { start: 1, end: 2.5 },
      { start: 2.5, end: 10 },
    ],
  });
});

test("a dropped or split word costs accuracy, not the segments after it", () => {
  const aligned = words("Hello Second line here Done");
  const timing = segmentStarts(["Hello there.", "Second line, here.", "Done."], aligned, 10);
  assert.deepEqual(
    timing.segments.map((s) => s.start),
    [0, 0.5, 2],
  );
});

test("starts never go backwards, even when a first word is not found", () => {
  const timing = segmentStarts(["Alpha beta.", "Zeta.", "Gamma."], words("Alpha beta Gamma"), 5);
  const starts = timing.segments.map((s) => s.start);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts);
});
