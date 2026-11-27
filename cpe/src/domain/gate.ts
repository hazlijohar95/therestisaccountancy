/*
 * When review questions interrupt an episode, as a pure state machine: the player feeds it what the audio element does
 * and what the listener does, and carries out the effects it returns. Nothing here touches the element, a clock or React.
 */

export interface Gate {
  /** Where playback was at the last time update, or null while seeking: a jump is never "passing" a question. */
  readonly last: number | null;
  /** The review question on screen. */
  readonly pending: number | null;
  /** Questions reached but left for later (hands-free, or in the background), in episode order. */
  readonly queued: readonly number[];
  /** The question that paused playback, so answering it plays on. Questions shown from the queue never resume. */
  readonly pausedFor: number | null;
  readonly ended: boolean;
}

export const loaded = (at: number): Gate => ({ last: at, pending: null, queued: [], pausedFor: null, ended: false });

/** What the player knows when the audio moves. */
export interface Moment {
  readonly to: number;
  readonly rate: number;
  /** When each review question falls, in seconds. */
  readonly checkpointTimes: readonly number[];
  /** Review questions the server has recorded as answered. */
  readonly answered: readonly number[];
  /** Whether this listener is asked questions at all: members only, never in a Studio preview. */
  readonly ask: boolean;
  /** Queue instead of pausing: hands-free is on, or the page is hidden and nobody can answer. */
  readonly defer: boolean;
}

export type GateEvent =
  | ({ type: "time" } & Moment)
  | { type: "seeking" }
  | { type: "seeked"; at: number }
  | { type: "playing" }
  | { type: "ended" }
  /** The question on screen was answered correctly. */
  | { type: "answered" }
  /** Play pressed on the lock screen or a headset, where nobody can answer the question on screen. */
  | { type: "remote-play" }
  /** The listener asked to answer the queued questions now. */
  | { type: "answer-queued" };

export type Effect = { type: "pause"; seek?: number } | { type: "play" };

export interface Step {
  readonly gate: Gate;
  readonly effects: readonly Effect[];
}

/** One time update covering more than this many seconds of audio per playback-rate unit is a seek, not listening. */
const MAX_TICK = 1.5;

const enqueue = (queued: readonly number[], i: number): number[] => (queued.includes(i) ? [...queued] : [...queued, i].sort((a, b) => a - b));

/** At the end of the episode, queued questions come up one by one. */
function settle(gate: Gate): Gate {
  return gate.ended && gate.pending === null && gate.queued.length > 0 ? { ...gate, pending: gate.queued[0]! } : gate;
}

function move(gate: Gate, m: Moment): Step {
  const from = gate.last;
  const moved = { ...gate, last: m.to };
  if (!m.ask || gate.pending !== null || from === null || m.to <= from || m.to - from > MAX_TICK * m.rate) return { gate: moved, effects: [] };
  // A question already waiting in the queue is asked from there, never again on the way past it.
  const hit = m.checkpointTimes.findIndex((at, i) => !m.answered.includes(i) && !gate.queued.includes(i) && from <= at && at <= m.to);
  if (hit < 0) return { gate: moved, effects: [] };
  if (m.defer) return { gate: { ...moved, queued: enqueue(gate.queued, hit) }, effects: [] };
  const at = m.checkpointTimes[hit]!;
  return {
    gate: { ...moved, last: at, pending: hit, pausedFor: hit },
    effects: [{ type: "pause", seek: at }],
  };
}

function next(gate: Gate, event: GateEvent): Step {
  switch (event.type) {
    case "time":
      return move(gate, event);
    case "seeking":
      return { gate: { ...gate, last: null }, effects: [] };
    case "seeked":
      return { gate: { ...gate, last: event.at }, effects: [] };
    case "playing":
      return { gate: { ...gate, ended: false }, effects: [] };
    case "ended":
      return { gate: { ...gate, ended: true }, effects: [] };
    case "answered": {
      // Nothing on screen: a repeat click on a dialog that is already closing. It must not bring up the queue.
      const done = gate.pending;
      if (done === null) return { gate, effects: [] };
      const rest = gate.queued.filter((q) => q !== done);
      if (gate.pausedFor === done) {
        return { gate: { ...gate, pending: null, pausedFor: null, queued: rest }, effects: [{ type: "play" }] };
      }
      // A queued question leads to the next one waiting, if any.
      return { gate: { ...gate, pending: rest[0] ?? null, queued: rest }, effects: [] };
    }
    case "remote-play": {
      const waiting = gate.pending;
      const queued = waiting === null ? gate.queued : enqueue(gate.queued, waiting);
      // Playing again means the episode has not ended, so the queue waits for the next end rather than coming straight back.
      return { gate: { ...gate, pending: null, pausedFor: null, queued, ended: false }, effects: [{ type: "play" }] };
    }
    case "answer-queued":
      if (gate.pending !== null || gate.queued.length === 0) return { gate, effects: [] };
      return { gate: { ...gate, pending: gate.queued[0]! }, effects: [{ type: "pause" }] };
  }
}

export function step(gate: Gate, event: GateEvent): Step {
  const { gate: after, effects } = next(gate, event);
  return { gate: settle(after), effects };
}
