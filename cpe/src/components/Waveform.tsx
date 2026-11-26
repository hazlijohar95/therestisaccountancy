import type { Range } from "../domain/progress.ts";
import type { Course } from "../domain/types.ts";

interface Props {
  course: Course;
  time: number;
  ranges: readonly Range[];
  answered: readonly number[];
  compact?: boolean;
  /** Draw the playhead. Off inside Scrubber, whose slider thumb is the playhead. */
  head?: boolean;
}

/**
 * The episode as evidence: bars turn green only where audio was actually heard,
 * skipped stretches show in red, and diamonds mark the review questions.
 */
export function Waveform({ course, time, ranges, answered, compact, head = true }: Props) {
  const n = course.peaks.length;
  const heard = (t: number) => ranges.some(([a, b]) => t >= a && t <= b);

  return (
    <div className={`wave${compact ? " wave--compact" : ""}`} aria-hidden>
      <svg className="wave__bars" viewBox={`0 0 ${n * 3} 100`} preserveAspectRatio="none">
        {course.peaks.map((p, i) => {
          const t = ((i + 0.5) / n) * course.duration;
          const state = heard(t) ? "heard" : t <= time ? "skipped" : "ahead";
          // Skipped audio collapses to a flat line, so it reads by shape as well as colour.
          const h = state === "skipped" ? 6 : Math.max(8, p * 100);
          return <rect key={i} className={`wave__bar wave__bar--${state}`} x={i * 3} y={(100 - h) / 2} width={2} height={h} />;
        })}
      </svg>
      {!compact &&
        course.chapters.slice(1).map((c) => (
          <span key={c.title} className="wave__chapter" style={{ left: `${(c.start / course.duration) * 100}%` }} />
        ))}
      {course.checkpointTimes.map((at, i) => (
        <span
          key={at}
          className={`wave__checkpoint${answered.includes(i) ? " wave__checkpoint--done" : ""}`}
          style={{ left: `${(at / course.duration) * 100}%` }}
        />
      ))}
      {head && <span className="wave__head" style={{ left: `${(time / course.duration) * 100}%` }} />}
    </div>
  );
}
