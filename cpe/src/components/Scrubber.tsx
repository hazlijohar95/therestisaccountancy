import { Slider } from "@base-ui/react/slider";
import { useState } from "react";
import { formatTime } from "../domain/courses.ts";
import { coverage, type Range } from "../domain/progress.ts";
import type { Course } from "../domain/types.ts";
import { Waveform } from "./Waveform.tsx";

interface Props {
  course: Course;
  time: number;
  ranges: readonly Range[];
  answered: readonly number[];
  onSeek: (t: number) => void;
  compact?: boolean;
}

/** A Base UI slider whose track is the waveform. Dragging previews; the seek happens on release. */
export function Scrubber({ course, time, ranges, answered, onSeek, compact }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? Math.min(time, course.duration);

  return (
    <Slider.Root
      className={`scrub${compact ? " scrub--compact" : ""}`}
      value={value}
      min={0}
      max={course.duration}
      step={1}
      largeStep={15}
      onValueChange={(v, d) => {
        if (d.reason === "drag") setDragging(v);
      }}
      onValueCommitted={(v) => {
        setDragging(null);
        onSeek(v);
      }}
    >
      <Slider.Control className="scrub__control">
        <Slider.Track className="scrub__track">
          <Waveform course={course} time={value} ranges={ranges} answered={answered} compact={compact} head={false} />
          <Slider.Thumb
            className="scrub__thumb"
            aria-label="Playback position"
            getAriaValueText={(_formatted, v) =>
              `${formatTime(v)} of ${formatTime(course.duration)}, ${Math.floor(coverage({ ranges }, course) * 100)}% heard`
            }
            data-test={compact ? "scrub-bar" : "scrub"}
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
