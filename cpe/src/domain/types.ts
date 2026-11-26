export type Field =
  | "Ethics"
  | "Accounting"
  | "Auditing"
  | "Taxation"
  | "Practice Management";

export type Level = "Basic" | "Intermediate" | "Advanced";

/** Credits move in half-hour steps. A half credit carries 3 quiz questions, a full credit 5. */
export type Credits = 0.5 | 1 | 1.5 | 2;

export interface Segment {
  /** Who is speaking, as the transcript shows it: a role like Host, or a name. */
  speaker: string;
  text: string;
  /** Starts a new chapter when set. */
  chapter?: string;
}

/** A question as the listener sees it: never its answer. */
export interface PublicQuestion {
  prompt: string;
  options: readonly string[];
}

/** A question as its author wrote it. Answers stay on the server. */
export interface Question extends PublicQuestion {
  answer: number;
  why: string;
}

/** A review question that interrupts playback once the listener reaches the end of a segment. */
export interface Checkpoint extends Question {
  afterSegment: number;
}

export interface PublicCheckpoint extends PublicQuestion {
  afterSegment: number;
}

export interface Show {
  id: string;
  title: string;
  blurb: string;
  art: "mic" | "papers";
}

export type CoverMotif = "ledger" | "dither" | "stamp" | "grid";

/** Everything an author writes for one version of a course, answers included. Server only. */
export interface CourseScript {
  id: string;
  showId: string;
  title: string;
  dek: string;
  field: Field;
  level: Level;
  credits: Credits;
  motif: CoverMotif;
  published: string;
  objectives: readonly string[];
  glossary: readonly { term: string; meaning: string }[];
  segments: readonly Segment[];
  checkpoints: readonly Checkpoint[];
  quiz: readonly Question[];
}

/** Where each segment sits in the audio, in seconds. */
export interface Timing {
  duration: number;
  segments: readonly { start: number; end: number }[];
}

/** A version's audio: where it plays from, and its shape measured when it was rendered or uploaded. */
export interface Audio {
  url: string;
  duration: number;
  /** Normalised loudness per bar. */
  peaks: readonly number[];
}

export interface TimedSegment extends Segment {
  start: number;
  end: number;
}

export interface Chapter {
  title: string;
  start: number;
}

/** One published version of a course, as the app plays it. Carries no answers. */
export interface Course {
  id: string;
  version: number;
  show: Show;
  title: string;
  dek: string;
  field: Field;
  level: Level;
  credits: Credits;
  motif: CoverMotif;
  published: string;
  objectives: readonly string[];
  glossary: readonly { term: string; meaning: string }[];
  audio: string;
  duration: number;
  segments: readonly TimedSegment[];
  chapters: readonly Chapter[];
  checkpoints: readonly PublicCheckpoint[];
  checkpointTimes: readonly number[];
  quizLength: number;
  peaks: readonly number[];
}
