export type Field =
  | "Ethics"
  | "Accounting"
  | "Auditing"
  | "Taxation"
  | "Practice Management";

export type Level = "Basic" | "Intermediate" | "Advanced";

/** Credits move in half-hour steps. A half credit carries 3 quiz questions, a full credit 5. */
export type Credits = 0.5 | 1 | 1.5 | 2;

export type Speaker = "Host" | "Guest";

export interface Segment {
  speaker: Speaker;
  text: string;
  /** Starts a new chapter when set. */
  chapter?: string;
}

export interface Question {
  prompt: string;
  options: readonly string[];
  answer: number;
  why: string;
}

/** A review question that interrupts playback once the listener reaches the end of a segment. */
export interface Checkpoint extends Question {
  afterSegment: number;
}

export interface Show {
  id: string;
  title: string;
  blurb: string;
  art: "mic" | "papers";
}

export type CoverMotif = "ledger" | "dither" | "stamp" | "grid";

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

/** Produced by scripts/build-audio.ts from the real rendered audio. */
export interface Timing {
  duration: number;
  segments: readonly { start: number; end: number }[];
}

export interface TimedSegment extends Segment {
  start: number;
  end: number;
}

export interface Chapter {
  title: string;
  start: number;
}

export interface Course extends Omit<CourseScript, "segments"> {
  show: Show;
  audio: string;
  duration: number;
  segments: readonly TimedSegment[];
  chapters: readonly Chapter[];
  checkpointTimes: readonly number[];
  /** Normalised loudness per bar, measured from the rendered audio. */
  peaks: readonly number[];
}
