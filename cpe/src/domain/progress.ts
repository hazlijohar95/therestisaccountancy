import { PASS_MARK } from "./courses.ts";
import type { Course, Field } from "./types.ts";

/** Share of the audio that must actually be played. Seeking past audio never counts. */
export const LISTEN_THRESHOLD = 0.95;

export type Range = readonly [number, number];

export interface Attempt {
  at: string;
  correct: number;
  total: number;
  passed: boolean;
}

export interface Certificate {
  id: string;
  courseId: string;
  issuedAt: string;
  name: string;
  correct: number;
  total: number;
}

export interface CourseProgress {
  ranges: readonly Range[];
  position: number;
  /** Indices of review checkpoints answered correctly. */
  checkpoints: readonly number[];
  attempts: readonly Attempt[];
}

export interface Requirement {
  start: string;
  end: string;
  target: number;
  minimums: Partial<Record<Field, number>>;
  /** True until the learner saves their own rules. */
  isExample?: boolean;
}

export interface LoggedEntry {
  id: string;
  date: string;
  title: string;
  provider: string;
  field: Field;
  hours: number;
}

export interface AppState {
  learner: string;
  progress: Readonly<Record<string, CourseProgress>>;
  certificates: readonly Certificate[];
  requirement: Requirement;
  logged: readonly LoggedEntry[];
}

export type Action =
  | { type: "heard"; courseId: string; ranges: readonly Range[]; at: number }
  | { type: "position"; courseId: string; at: number }
  | { type: "checkpoint"; courseId: string; index: number }
  | { type: "attempt"; courseId: string; correct: number; total: number; at: string; certificateId: string }
  | { type: "learner"; name: string }
  | { type: "requirement"; requirement: Requirement }
  | { type: "log"; entry: LoggedEntry }
  | { type: "unlog"; id: string }
  | { type: "reset" };

const year = new Date().getFullYear();

export const initialState: AppState = {
  learner: "",
  progress: {},
  certificates: [],
  requirement: { start: `${year}-01-01`, end: `${year}-12-31`, target: 40, minimums: { Ethics: 4 }, isExample: true },
  logged: [],
};

const blank: CourseProgress = { ranges: [], position: 0, checkpoints: [], attempts: [] };

export const progressOf = (state: AppState, courseId: string): CourseProgress => state.progress[courseId] ?? blank;

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "heard":
      return patch(state, action.courseId, (p) => ({ ranges: merge([...p.ranges, ...action.ranges]), position: action.at }));
    case "position":
      return patch(state, action.courseId, () => ({ position: action.at }));
    case "checkpoint":
      return patch(state, action.courseId, (p) =>
        p.checkpoints.includes(action.index) ? {} : { checkpoints: [...p.checkpoints, action.index] },
      );
    case "attempt": {
      const passed = action.correct / action.total >= PASS_MARK;
      const next = patch(state, action.courseId, (p) => ({
        attempts: [...p.attempts, { at: action.at, correct: action.correct, total: action.total, passed }],
      }));
      if (!passed || state.certificates.some((c) => c.courseId === action.courseId)) return next;
      const certificate: Certificate = {
        id: action.certificateId,
        courseId: action.courseId,
        issuedAt: action.at,
        name: state.learner,
        correct: action.correct,
        total: action.total,
      };
      return { ...next, certificates: [...next.certificates, certificate] };
    }
    case "learner":
      return {
        ...state,
        learner: action.name,
        certificates: state.certificates.map((c) => (c.name ? c : { ...c, name: action.name })),
      };
    case "requirement":
      return { ...state, requirement: action.requirement };
    case "log":
      return { ...state, logged: [...state.logged, action.entry] };
    case "unlog":
      return { ...state, logged: state.logged.filter((e) => e.id !== action.id) };
    case "reset":
      return initialState;
  }
}

function patch(state: AppState, courseId: string, f: (p: CourseProgress) => Partial<CourseProgress>): AppState {
  const current = progressOf(state, courseId);
  return { ...state, progress: { ...state.progress, [courseId]: { ...current, ...f(current) } } };
}

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

export const coverage = (p: CourseProgress, course: Course): number =>
  Math.min(1, p.ranges.reduce((sum, [a, b]) => sum + (b - a), 0) / course.duration);

export type Phase =
  | { kind: "new" }
  | { kind: "listening"; heard: number; checkpointsLeft: number }
  | { kind: "ready"; failedAttempts: number }
  | { kind: "certified"; certificate: Certificate };

/** The course's place on the credit path, derived so it can never disagree with the evidence. */
export function phaseOf(state: AppState, course: Course): Phase {
  const certificate = state.certificates.find((c) => c.courseId === course.id);
  if (certificate) return { kind: "certified", certificate };
  const p = progressOf(state, course.id);
  const heard = coverage(p, course);
  const checkpointsLeft = course.checkpoints.length - p.checkpoints.length;
  if (heard >= LISTEN_THRESHOLD && checkpointsLeft === 0) {
    return { kind: "ready", failedAttempts: p.attempts.filter((a) => !a.passed).length };
  }
  if (heard === 0 && p.position === 0) return { kind: "new" };
  return { kind: "listening", heard, checkpointsLeft };
}

export function newCertificateId(course: Course, at: Date): string {
  const stamp = at.toISOString().slice(0, 10).replaceAll("-", "");
  const code = course.id
    .split("-")
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const nonce = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TRIA-${code}-${stamp}-${nonce}`;
}
