import assert from "node:assert/strict";
import { test } from "node:test";
import { loaded, step, type Effect, type Gate, type GateEvent, type Moment } from "./gate.ts";

/** An episode with review questions at 30s and 60s, heard by a member at 1x with nothing answered yet. */
const moment = (to: number, over: Partial<Moment> = {}): GateEvent => ({
  type: "time",
  to,
  rate: 1,
  checkpointTimes: [30, 60],
  answered: [],
  ask: true,
  defer: false,
  ...over,
});

/** Runs events from a gate, collecting every effect in order. */
function run(gate: Gate, ...events: GateEvent[]): { gate: Gate; effects: Effect[] } {
  const effects: Effect[] = [];
  for (const event of events) {
    const s = step(gate, event);
    gate = s.gate;
    effects.push(...s.effects);
  }
  return { gate, effects };
}

/** Plays from `from` to `to` in quarter-second updates, as the element reports them. */
const ticks = (from: number, to: number, over: Partial<Moment> = {}): GateEvent[] =>
  Array.from({ length: Math.round((to - from) * 4) }, (_, i) => moment(from + (i + 1) / 4, over));

test("passing a question pauses on it, and answering it plays on", () => {
  const { gate, effects } = run(loaded(25), ...ticks(25, 31));
  assert.equal(gate.pending, 0);
  assert.deepEqual(effects, [{ type: "pause", seek: 30 }]);
  const after = run(gate, { type: "answered" });
  assert.equal(after.gate.pending, null);
  assert.deepEqual(after.effects, [{ type: "play" }]);
});

test("seeking past a question never stops on it, and nor does a jump the element reports as one update", () => {
  const seeked = run(loaded(0), { type: "seeking" }, { type: "seeked", at: 45 }, ...ticks(45, 50));
  assert.equal(seeked.gate.pending, null);
  assert.deepEqual(seeked.effects, []);
  const jumped = run(loaded(25), moment(40));
  assert.equal(jumped.gate.pending, null, "15 seconds in one update at 1x is a seek");
  const fast = run(loaded(29), moment(31, { rate: 2 }));
  assert.equal(fast.gate.pending, 0, "2 seconds in one update at 2x is listening");
});

test("answered questions, non-members and previews are never asked", () => {
  assert.equal(run(loaded(25), ...ticks(25, 31, { answered: [0] })).gate.pending, null);
  assert.equal(run(loaded(25), ...ticks(25, 31, { ask: false })).gate.pending, null);
});

test("hands-free queues questions in order and plays on, then asks them one by one at the end", () => {
  const { gate, effects } = run(loaded(0), ...ticks(0, 70, { defer: true }));
  assert.deepEqual(gate.queued, [0, 1]);
  assert.equal(gate.pending, null);
  assert.deepEqual(effects, [], "nothing pauses");
  const end = run(gate, { type: "ended" });
  assert.equal(end.gate.pending, 0);
  const second = run(end.gate, { type: "answered" });
  assert.equal(second.gate.pending, 1);
  assert.deepEqual(second.effects, [], "a queued question never resumes playback");
  const done = run(second.gate, { type: "answered" });
  assert.equal(done.gate.pending, null);
  assert.deepEqual(done.gate.queued, []);
});

test("asking for queued questions mid-episode pauses and shows the first", () => {
  const { gate } = run(loaded(25), ...ticks(25, 31, { defer: true }));
  const asked = run(gate, { type: "answer-queued" });
  assert.equal(asked.gate.pending, 0);
  assert.deepEqual(asked.effects, [{ type: "pause" }]);
  assert.deepEqual(run(asked.gate, { type: "answer-queued" }).effects, [], "nothing more while one is on screen");
});

test("play from the lock screen leaves the question on screen for later and plays on", () => {
  const { gate } = run(loaded(25), ...ticks(25, 31));
  const remote = run(gate, { type: "remote-play" });
  assert.equal(remote.gate.pending, null);
  assert.deepEqual(remote.gate.queued, [0]);
  assert.deepEqual(remote.effects, [{ type: "play" }]);
  const later = run(remote.gate, ...ticks(31, 61));
  assert.equal(later.gate.pending, 1, "the next question still pauses");
  assert.deepEqual(run(later.gate, { type: "answered" }).gate.queued, [0], "and answering it leaves the deferred one queued");
});

test("a queued question is not asked again on the way past it", () => {
  const queued = run(loaded(25), ...ticks(25, 31, { defer: true }));
  const back = run(queued.gate, { type: "seeking" }, { type: "seeked", at: 25 }, ...ticks(25, 31));
  assert.equal(back.gate.pending, null);
  assert.deepEqual(back.gate.queued, [0]);
  assert.deepEqual(back.effects, []);
});

test("once paused on a question, further time updates change nothing until it is answered", () => {
  const { gate, effects } = run(loaded(59), ...ticks(59, 61), moment(61.25));
  assert.equal(gate.pending, 1);
  assert.deepEqual(effects, [{ type: "pause", seek: 60 }]);
});

test("a repeat answer with nothing on screen does nothing, even with questions queued", () => {
  const { gate } = run(loaded(0), ...ticks(0, 31, { defer: true }), ...ticks(31, 61));
  assert.deepEqual(gate.queued, [0]);
  const answered = run(gate, { type: "answered" });
  assert.equal(answered.gate.pending, null);
  const again = run(answered.gate, { type: "answered" });
  assert.equal(again.gate, answered.gate);
  assert.deepEqual(again.effects, []);
});

test("play from the lock screen after the end plays on without putting the question straight back", () => {
  const { gate } = run(loaded(0), ...ticks(0, 31, { defer: true }), { type: "ended" });
  assert.equal(gate.pending, 0);
  const remote = run(gate, { type: "remote-play" });
  assert.equal(remote.gate.pending, null);
  assert.deepEqual(remote.gate.queued, [0]);
  assert.equal(run(remote.gate, { type: "ended" }).gate.pending, 0, "it comes up at the next end");
});
