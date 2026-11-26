import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIO_KEY, parseRange } from "./audio.ts";

test("Range headers become R2 ranges; anything else is a whole-file request", () => {
  assert.deepEqual(parseRange("bytes=0-99"), { offset: 0, length: 100 });
  assert.deepEqual(parseRange("bytes=100-"), { offset: 100 });
  assert.deepEqual(parseRange("bytes=-500"), { suffix: 500 });
  assert.equal(parseRange("bytes=9-3"), null);
  assert.equal(parseRange("bytes=0-1,5-9"), null);
  assert.equal(parseRange(null), null);
});

test("only Studio upload keys are served from the bucket", () => {
  assert.equal(AUDIO_KEY.test("courses/five-threats/ABCDEFGHJKLMNPQR.m4a"), true);
  assert.equal(AUDIO_KEY.test("courses/../secrets.m4a"), false);
  assert.equal(AUDIO_KEY.test("other/x/ABCDEFGHJKLMNPQR.m4a"), false);
});
