import { coverage as heardShare, LISTEN_THRESHOLD, type Range } from "./rules.ts";
import type { Course, Field, Level } from "./types.ts";

export { LISTEN_THRESHOLD, merge, type Range } from "./rules.ts";

export interface Attempt {
  at: string;
  correct: number;
  total: number;
  passed: boolean;
}

/** Issued by the server when an assessment is passed. It carries what it certifies, so it never changes with the catalogue. */
export interface Certificate {
  id: string;
  courseId: string;
  version: number;
  issuedAt: string;
  name: string;
  correct: number;
  total: number;
  title: string;
  provider: string;
  field: Field;
  level: Level;
  credits: number;
}

/** A listener's evidence for the version of a course they are on. */
export interface CourseProgress {
  version: number;
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

/**
 * Hours from outside the app. Self-reported: logged by hand. Unverified: a certificate a browser made before accounts,
 * brought across as a claim, never as a certificate.
 */
export interface LoggedEntry {
  id: string;
  date: string;
  title: string;
  provider: string;
  field: Field;
  hours: number;
  source: "self-reported" | "unverified";
}

export interface AppState {
  learner: string;
  progress: Readonly<Record<string, CourseProgress>>;
  certificates: readonly Certificate[];
  requirement: Requirement;
  logged: readonly LoggedEntry[];
}

const year = new Date().getFullYear();

export const exampleRequirement: Requirement = { start: `${year}-01-01`, end: `${year}-12-31`, target: 40, minimums: { Ethics: 4 }, isExample: true };

export const emptyState: AppState = { learner: "", progress: {}, certificates: [], requirement: exampleRequirement, logged: [] };

const blank: CourseProgress = { version: 0, ranges: [], position: 0, checkpoints: [], attempts: [] };

/** Progress on the version of the course being shown. Progress on another version is not this one's. */
export const progressOf = (state: AppState, course: Pick<Course, "id" | "version">): CourseProgress => {
  const p = state.progress[course.id];
  return p && p.version === course.version ? p : blank;
};

export const coverage = (p: Pick<CourseProgress, "ranges">, course: Pick<Course, "duration">): number => heardShare(p.ranges, course.duration);

export type Phase =
  | { kind: "new" }
  | { kind: "listening"; heard: number; checkpointsLeft: number }
  | { kind: "ready"; failedAttempts: number }
  | { kind: "certified"; certificate: Certificate };

/** The course's place on the credit path, derived from the server's evidence so it can never disagree with it. */
export function phaseOf(state: AppState, course: Course): Phase {
  const certificate = state.certificates.find((c) => c.courseId === course.id);
  if (certificate) return { kind: "certified", certificate };
  const p = progressOf(state, course);
  const heard = coverage(p, course);
  const checkpointsLeft = course.checkpoints.length - p.checkpoints.length;
  if (heard >= LISTEN_THRESHOLD && checkpointsLeft <= 0) {
    return { kind: "ready", failedAttempts: p.attempts.filter((a) => !a.passed).length };
  }
  if (heard === 0 && p.position === 0) return { kind: "new" };
  return { kind: "listening", heard, checkpointsLeft };
}
