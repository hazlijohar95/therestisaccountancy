/*
 * The credit rules, shared by the server, which decides credit, and the app, which shows where a listener stands.
 * Pure functions only: nothing here reads a clock, storage or the network.
 */

/** Share of the audio that must actually be played. Seeking past audio never counts. */
export const LISTEN_THRESHOLD = 0.95;

/** Share of assessment questions to answer correctly. Retakes are unlimited. */
export const PASS_MARK = 0.7;

/** The playback speeds the player offers. The fastest bounds how much audio can be heard per second of real time. */
export const RATES = [1, 1.25, 1.5, 1.75, 2] as const;
export type Rate = (typeof RATES)[number];
export const MAX_RATE = 2;

/**
 * The most real time one report can draw on, in seconds. Time is banked between reports so a phone that sends late
 * (backgrounded, offline for a stretch) still gets its audio counted, but an idle hour cannot be spent as two hours
 * of heard audio.
 */
export const BANK_SECONDS = 600;

export type Range = readonly [number, number];

/** Sorts and unions overlapping played ranges. */
export function merge(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.25) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const seconds = (ranges: readonly Range[]): number => ranges.reduce((sum, [a, b]) => sum + (b - a), 0);

export const coverage = (ranges: readonly Range[], duration: number): number => (duration > 0 ? Math.min(1, seconds(ranges) / duration) : 0);

/** Listened enough and answered every review question: the assessment is open. */
export const readyForAssessment = (ranges: readonly Range[], duration: number, answered: number, checkpoints: number): boolean =>
  coverage(ranges, duration) >= LISTEN_THRESHOLD && answered >= checkpoints;

export const passes = (correct: number, total: number): boolean => total > 0 && correct / total >= PASS_MARK;

/** The parts of `reported` not already in `accepted`, earliest first. */
function newPieces(accepted: readonly Range[], reported: readonly Range[]): Range[] {
  const pieces: Range[] = [];
  for (const [a, b] of merge(reported)) {
    let from = a;
    for (const [x, y] of accepted) {
      if (y <= from || x >= b) continue;
      if (x > from) pieces.push([from, x]);
      from = Math.max(from, y);
    }
    if (from < b) pieces.push([from, b]);
  }
  return pieces;
}

/**
 * What the server keeps of a report: everything already accepted, plus as much newly heard audio as the budget
 * allows, earliest first. A report can never take away audio already accepted.
 */
export function acceptHeard(accepted: readonly Range[], reported: readonly Range[], budget: number, duration: number): { ranges: Range[]; spent: number } {
  const inBounds = reported.flatMap(([a, b]): Range[] => {
    const from = Math.max(0, a);
    const to = Math.min(duration, b);
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? [[from, to]] : [];
  });
  let left = Math.max(0, budget);
  const taken: Range[] = [];
  for (const [a, b] of newPieces(accepted, inBounds)) {
    if (left <= 0) break;
    const end = Math.min(b, a + left);
    taken.push([a, end]);
    left -= end - a;
  }
  return { ranges: merge([...accepted, ...taken]), spent: Math.max(0, budget) - left };
}

/**
 * The heard-time budget is a bucket of seconds, per listener across every course and tab. Real time fills it at the
 * fastest playback rate, up to BANK_SECONDS of real time, and accepted audio drains it.
 */
export function refill(credit: number, elapsedSeconds: number): number {
  const cap = BANK_SECONDS * MAX_RATE;
  return Math.min(cap, Math.max(0, credit) + Math.max(0, elapsedSeconds) * MAX_RATE);
}
