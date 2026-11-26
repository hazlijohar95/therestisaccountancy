import type { AppState, Certificate, CourseProgress } from "./progress.ts";
import type { Range } from "./rules.ts";
import type { Audio, Course, CourseScript, Field, Level, PublicQuestion, Show, Timing } from "./types.ts";

/** The contract between the app and the CPE Worker. Every response is JSON in one of these shapes. */

export interface Member {
  name: string;
  email: string;
  role: "member" | "admin";
}

/** Who is here, decided by the club: signed out, signed in without paid membership, or a member with their record. */
export type Session =
  | { status: "signed-out"; signIn: string }
  | { status: "unpaid"; member: Member; pay: string }
  | { status: "member"; member: Member; state: AppState; club: string };

export interface Catalogue {
  shows: Show[];
  courses: Course[];
}

export interface HeardReport {
  courseId: string;
  version: number;
  ranges: Range[];
  position: number;
}

export type ReviewAnswer = { correct: true; why: string; progress: CourseProgress } | { correct: false };

export interface Sitting {
  id: string;
  questions: PublicQuestion[];
}

export interface Graded {
  correct: number;
  total: number;
  passed: boolean;
  /** Each question with its options in the author's order, what was picked, the answer and why. Sent only after grading. */
  review: { prompt: string; options: string[]; picked: number | null; answer: number; why: string }[];
  /** The certificate this sitting earned, or null. */
  certificate: Certificate | null;
  state: AppState;
}

/** The public confirmation of a certificate: enough to check it is genuine, nothing more. */
export interface Verified {
  id: string;
  name: string;
  title: string;
  field: Field;
  level: Level;
  credits: number;
  issuedAt: string;
  version: number;
}

/** The prototype's browser record as the app found it. The server checks every field and drops what does not read. */
export interface LegacyImport {
  learner?: string;
  requirement?: unknown;
  logged: { id: string; date: string; title: string; provider: string; field: string; hours: number }[];
  certificates: { id: string; courseId: string; issuedAt: string; title: string; provider: string; field: Field; hours: number }[];
  positions: { courseId: string; position: number }[];
}

export interface ApiError {
  error: string;
}

/* The Studio, for club admins only. These carry answers: they are never sent to anyone but an admin. */

export type VersionStatus = "draft" | "published";

/** One version of a course as an author sees it, answers included. */
export interface StudioVersion {
  readonly courseId: string;
  readonly version: number;
  readonly status: VersionStatus;
  readonly script: CourseScript;
  readonly audio: Audio | null;
  readonly timing: Timing | null;
  readonly author: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface StudioIndex {
  courses: readonly { id: string; title: string; showId: string; versions: readonly { version: number; status: VersionStatus; updatedAt: string; publishedAt: string | null }[] }[];
  shows: Show[];
  /** Whether automatic alignment is configured. Without it, timings are set by hand. */
  aligner: string | null;
}

export interface StudioCourse {
  draft: StudioVersion | null;
  /** The newest published version, for reference while editing. */
  live: StudioVersion | null;
  /** Why the draft cannot be published yet. Empty when it can. */
  problems: string[];
  shows: Show[];
  aligner: string | null;
}

export interface UploadStart {
  key: string;
  uploadId: string;
  /** Bytes per part. Every part but the last must be exactly this size. */
  partSize: number;
}
