import type { Requirement } from "../src/domain/progress.ts";
import { merge, type Range } from "../src/domain/rules.ts";
import type { Audio, Checkpoint, CourseScript, CoverMotif, Credits, Field, Level, Question, Segment, Show, Timing } from "../src/domain/types.ts";
import { fields } from "../src/domain/courses.ts";

/** Input that does not have the shape the API expects. The router answers it with 400 and the message. */
export class Invalid extends Error {}

const fail = (path: string, what: string): never => {
  throw new Invalid(`${path} ${what}`);
};

export function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(path, "must be an object");
  return Object.fromEntries(Object.entries(value));
}

export function list(value: unknown, path: string, max = 2000): unknown[] {
  if (!Array.isArray(value)) return fail(path, "must be a list");
  if (value.length > max) return fail(path, `has more than ${max} items`);
  return value;
}

export function string(value: unknown, path: string, { max = 5000, empty = false } = {}): string {
  if (typeof value !== "string") return fail(path, "must be text");
  const v = value.trim();
  if (!empty && !v) return fail(path, "must not be empty");
  if (v.length > max) return fail(path, `must be at most ${max} characters`);
  return v;
}

export function number(value: unknown, path: string, { min = -Infinity, max = Infinity } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(path, "must be a number");
  if (value < min || value > max) return fail(path, `must be between ${min} and ${max}`);
  return value;
}

export function integerIn(value: unknown, path: string, min: number, max: number): number {
  const n = number(value, path, { min, max });
  return Number.isInteger(n) ? n : fail(path, "must be a whole number");
}

export function oneOf<const T extends string | number>(value: unknown, path: string, allowed: readonly T[]): T {
  const match = allowed.find((a) => a === value);
  return match === undefined ? fail(path, `must be one of ${allowed.join(", ")}`) : match;
}

const optional = <T>(value: unknown, read: (v: unknown) => T): T | undefined => (value === undefined || value === null || value === "" ? undefined : read(value));

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slug(value: unknown, path: string): string {
  const v = string(value, path, { max: 80 });
  return SLUG.test(v) ? v : fail(path, "must be lowercase words joined by hyphens");
}

export function isoDate(value: unknown, path: string): string {
  const v = string(value, path, { max: 10 });
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(path, "must be a date like 2026-01-31");
}

export const FIELDS: readonly Field[] = fields;
export const LEVELS: readonly Level[] = ["Basic", "Intermediate", "Advanced"];
export const CREDITS: readonly Credits[] = [0.5, 1, 1.5, 2];
export const MOTIFS: readonly CoverMotif[] = ["ledger", "dither", "stamp", "grid"];

export function ranges(value: unknown, path: string): Range[] {
  return merge(
    list(value, path, 5000).map((r, i): Range => {
      const pair = list(r, `${path}[${i}]`, 2);
      const a = number(pair[0], `${path}[${i}][0]`, { min: 0 });
      const b = number(pair[1], `${path}[${i}][1]`, { min: 0 });
      return [a, b];
    }),
    0,
  );
}

function question(value: unknown, path: string): Question {
  const q = record(value, path);
  const options = list(q.options, `${path}.options`, 4).map((o, i) => string(o, `${path}.options[${i}]`, { max: 500 }));
  if (options.length < 2) fail(`${path}.options`, "needs at least 2 options");
  if (new Set(options).size !== options.length) fail(`${path}.options`, "must all differ");
  return {
    prompt: string(q.prompt, `${path}.prompt`, { max: 1000 }),
    options,
    answer: integerIn(q.answer, `${path}.answer`, 0, options.length - 1),
    why: string(q.why, `${path}.why`, { max: 2000 }),
  };
}

function segment(value: unknown, path: string): Segment {
  const s = record(value, path);
  const chapter = optional(s.chapter, (v) => string(v, `${path}.chapter`, { max: 200 }));
  return { speaker: string(s.speaker, `${path}.speaker`, { max: 80 }), text: string(s.text, `${path}.text`, { max: 5000 }), ...(chapter ? { chapter } : {}) };
}

/** A course script as an author saved it. Drafts may be incomplete only in what publishing checks separately. */
export function script(value: unknown, path = "course"): CourseScript {
  const c = record(value, path);
  const segments = list(c.segments, `${path}.segments`, 500).map((s, i) => segment(s, `${path}.segments[${i}]`));
  const checkpoints = list(c.checkpoints, `${path}.checkpoints`, 50).map((v, i): Checkpoint => {
    const p = `${path}.checkpoints[${i}]`;
    const afterSegment = integerIn(record(v, p).afterSegment, `${p}.afterSegment`, 0, Math.max(0, segments.length - 1));
    return { ...question(v, p), afterSegment };
  });
  return {
    id: slug(c.id, `${path}.id`),
    showId: slug(c.showId, `${path}.showId`),
    title: string(c.title, `${path}.title`, { max: 200 }),
    dek: string(c.dek, `${path}.dek`, { max: 500 }),
    field: oneOf(c.field, `${path}.field`, FIELDS),
    level: oneOf(c.level, `${path}.level`, LEVELS),
    credits: oneOf(c.credits, `${path}.credits`, CREDITS),
    motif: oneOf(c.motif, `${path}.motif`, MOTIFS),
    published: isoDate(c.published, `${path}.published`),
    objectives: list(c.objectives, `${path}.objectives`, 30).map((o, i) => string(o, `${path}.objectives[${i}]`, { max: 500 })),
    glossary: list(c.glossary, `${path}.glossary`, 100).map((g, i) => {
      const e = record(g, `${path}.glossary[${i}]`);
      return { term: string(e.term, `${path}.glossary[${i}].term`, { max: 200 }), meaning: string(e.meaning, `${path}.glossary[${i}].meaning`, { max: 1000 }) };
    }),
    segments,
    checkpoints,
    quiz: list(c.quiz, `${path}.quiz`, 50).map((q, i) => question(q, `${path}.quiz[${i}]`)),
  };
}

export function timing(value: unknown, path = "timing"): Timing {
  const t = record(value, path);
  const duration = number(t.duration, `${path}.duration`, { min: 0 });
  const segments = list(t.segments, `${path}.segments`, 500).map((s, i) => {
    const r = record(s, `${path}.segments[${i}]`);
    const start = number(r.start, `${path}.segments[${i}].start`, { min: 0, max: duration });
    const end = number(r.end, `${path}.segments[${i}].end`, { min: start, max: duration });
    return { start, end };
  });
  segments.forEach((s, i) => {
    if (i > 0 && s.start < segments[i - 1]!.start) fail(`${path}.segments[${i}].start`, "must not come before the segment above it");
  });
  return { duration, segments };
}

export function audio(value: unknown, path = "audio"): Audio {
  const a = record(value, path);
  return {
    url: string(a.url, `${path}.url`, { max: 500 }),
    duration: number(a.duration, `${path}.duration`, { min: 0.1 }),
    peaks: list(a.peaks, `${path}.peaks`, 2000).map((p, i) => number(p, `${path}.peaks[${i}]`, { min: 0, max: 1 })),
  };
}

export function show(value: unknown, path = "show"): Show {
  const s = record(value, path);
  return { id: slug(s.id, `${path}.id`), title: string(s.title, `${path}.title`, { max: 200 }), blurb: string(s.blurb, `${path}.blurb`, { max: 500 }), art: oneOf(s.art, `${path}.art`, ["mic", "papers"] as const) };
}

export function requirement(value: unknown, path = "requirement"): Requirement {
  const r = record(value, path);
  const start = isoDate(r.start, `${path}.start`);
  const end = isoDate(r.end, `${path}.end`);
  if (end < start) fail(`${path}.end`, "must not come before the start");
  const m = record(r.minimums ?? {}, `${path}.minimums`);
  const minimums: Partial<Record<Field, number>> = {};
  for (const f of FIELDS) {
    const v = optional(m[f], (x) => number(x, `${path}.minimums.${f}`, { min: 0, max: 1000 }));
    if (v) minimums[f] = v;
  }
  return { start, end, target: number(r.target, `${path}.target`, { min: 0, max: 1000 }), minimums, ...(r.isExample === true ? { isExample: true } : {}) };
}
