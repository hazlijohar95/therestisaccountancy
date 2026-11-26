import type { Chapter, CourseScript, Course, Field, Show, Timing } from "./types.ts";

export { PASS_MARK } from "./rules.ts";

export const fields: readonly Field[] = ["Ethics", "Accounting", "Auditing", "Taxation", "Practice Management"];

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatHours(h: number): string {
  return Number.isInteger(h) ? h.toFixed(1) : String(Math.round(h * 10) / 10);
}

/**
 * The course as the app plays it, from what its author wrote and the audio's timings. Answers and explanations are
 * dropped here; review options come in the order given, which the server shuffles per listener.
 */
export function playable(
  script: CourseScript,
  version: number,
  show: Show,
  audio: { url: string; duration: number; peaks: readonly number[] },
  timing: Timing,
  optionOrder: (checkpoint: number) => readonly number[] = (i) => script.checkpoints[i]!.options.map((_, n) => n),
): Course {
  if (timing.segments.length !== script.segments.length) throw new Error(`Timings for "${script.id}" do not match its transcript.`);
  const segments = script.segments.map((seg, i) => ({ ...seg, ...timing.segments[i]! }));
  const chapters: Chapter[] = segments.flatMap((s) => (s.chapter ? [{ title: s.chapter, start: s.start }] : []));
  return {
    id: script.id,
    version,
    show,
    title: script.title,
    dek: script.dek,
    field: script.field,
    level: script.level,
    credits: script.credits,
    motif: script.motif,
    published: script.published,
    objectives: script.objectives,
    glossary: script.glossary,
    audio: audio.url,
    duration: audio.duration,
    segments,
    chapters,
    checkpoints: script.checkpoints.map((c, i) => ({
      afterSegment: c.afterSegment,
      prompt: c.prompt,
      options: optionOrder(i).map((n) => c.options[n]!),
    })),
    checkpointTimes: script.checkpoints.map((c) => segments[c.afterSegment]!.end),
    quizLength: script.quiz.length,
    peaks: audio.peaks,
  };
}
