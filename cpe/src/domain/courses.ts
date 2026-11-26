import { scripts, shows } from "../content/catalog.ts";
import timings from "../content/timings.json";
import type { Chapter, Course, CourseScript, Field, Show } from "./types.ts";

interface RenderedAudio {
  duration: number;
  segments: readonly { start: number; end: number }[];
  peaks: readonly number[];
}

const rendered: Record<string, RenderedAudio | undefined> = timings;

function build(script: CourseScript): Course {
  const audio = rendered[script.id];
  if (!audio || audio.segments.length !== script.segments.length) {
    throw new Error(`Audio for "${script.id}" is missing or stale. Run npm run audio.`);
  }
  const show: Show | undefined = shows.find((s) => s.id === script.showId);
  if (!show) throw new Error(`Unknown show "${script.showId}"`);

  const segments = script.segments.map((seg, i) => ({ ...seg, ...audio.segments[i]! }));
  const chapters: Chapter[] = segments.flatMap((s) => (s.chapter ? [{ title: s.chapter, start: s.start }] : []));
  return {
    ...script,
    show,
    audio: `/audio/${script.id}.m4a`,
    duration: audio.duration,
    segments,
    chapters,
    checkpointTimes: script.checkpoints.map((c) => segments[c.afterSegment]!.end),
    peaks: audio.peaks,
  };
}

export const courses: readonly Course[] = scripts.map(build);

export const courseById = (id: string): Course | undefined => courses.find((c) => c.id === id);

export const fields: readonly Field[] = ["Ethics", "Accounting", "Auditing", "Taxation", "Practice Management"];

export const PASS_MARK = 0.7;

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatHours(h: number): string {
  return Number.isInteger(h) ? h.toFixed(1) : String(Math.round(h * 10) / 10);
}
