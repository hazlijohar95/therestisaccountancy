import { Slider } from "@base-ui/react/slider";
import { useState } from "react";
import { Cover } from "../components/Cover.tsx";
import { Back, Forward, Pause, Play } from "../components/Icons.tsx";
import { courses, formatHours, formatTime } from "../domain/courses.ts";
import type { Course } from "../domain/types.ts";
import { usePlayer } from "../player.tsx";
import { BarVisualizer } from "./elevenlabs/BarVisualizer.tsx";

/**
 * A playlist and player in the style of ElevenLabs UI's audio player, driven by the app's own player,
 * so what you hear here counts towards the course like it does in the app.
 */
export function SamplePlayer() {
  const player = usePlayer();
  const [picked, setPicked] = useState<Course>(courses[0]!);
  const course = player.course ?? picked;
  const active = player.course?.id === course.id;
  const playing = active && player.playing;
  const [dragging, setDragging] = useState<number | null>(null);
  const time = dragging ?? (active ? Math.min(player.time, course.duration) : 0);
  const line = course.segments.find((s) => time >= s.start && time < s.end) ?? course.segments[0]!;

  const toggle = () => (active ? player.toggle() : player.play(course, 0));
  const choose = (c: Course) => {
    setPicked(c);
    if (player.course?.id === c.id) player.toggle();
    else player.play(c, 0);
  };
  const seek = (t: number) => (active ? player.seek(t) : player.play(course, t));

  return (
    <div className="el-player">
      <div className="el-player__card">
        <div className="el-player__head">
          <Cover course={course} size="sm" />
          <div className="el-player__meta">
            <span className="el-player__title">{course.title}</span>
            <span className="el-player__sub">
              {course.show.title} · {course.field}
            </span>
          </div>
          <span className="el-chip">{formatHours(course.credits)} CPE</span>
        </div>

        <div className="el-player__stage">
          <BarVisualizer state={playing ? "speaking" : "idle"} barCount={28} />
        </div>

        <p className="el-player__line" aria-live="off">
          <span className="el-player__speaker">{line.speaker}</span>
          {line.text}
        </p>

        <Slider.Root
          className="el-scrub"
          value={time}
          min={0}
          max={course.duration}
          step={1}
          largeStep={15}
          onValueChange={(v, d) => {
            if (d.reason === "drag") setDragging(v);
          }}
          onValueCommitted={(v) => {
            setDragging(null);
            seek(v);
          }}
        >
          <Slider.Control className="el-scrub__control">
            <Slider.Track className="el-scrub__track">
              <Slider.Indicator className="el-scrub__range" />
              <Slider.Thumb className="el-scrub__thumb" aria-label="Playback position" getAriaValueText={(_f, v) => `${formatTime(v)} of ${formatTime(course.duration)}`} />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
        <div className="el-player__times">
          <span>{formatTime(time)}</span>
          <span>{formatTime(course.duration)}</span>
        </div>

        <div className="el-player__controls">
          <button type="button" className="el-icon-btn" onClick={() => seek(Math.max(0, time - 15))} aria-label="Back 15 seconds">
            <Back width={20} height={20} />
          </button>
          <button type="button" className="el-play" onClick={toggle} aria-label={`${playing ? "Pause" : "Play"} ${course.title}`} data-on={playing || undefined}>
            {playing ? <Pause width={22} height={22} /> : <Play width={22} height={22} />}
          </button>
          <button type="button" className="el-icon-btn" onClick={() => seek(Math.min(course.duration, time + 15))} aria-label="Forward 15 seconds">
            <Forward width={20} height={20} />
          </button>
        </div>
      </div>

      <ol className="el-list" aria-label="Sample courses">
        {courses.map((c, i) => {
          const on = c.id === course.id;
          const live = on && playing;
          return (
            <li key={c.id}>
              <button type="button" className="el-list__row" data-on={on || undefined} onClick={() => choose(c)} aria-label={`${live ? "Pause" : "Play"} ${c.title}`}>
                <span className="el-list__n" aria-hidden>
                  {live ? <BarVisualizer state="speaking" barCount={3} className="el-bars--tiny" /> : i + 1}
                </span>
                <span className="el-list__text">
                  <span className="el-list__title">{c.title}</span>
                  <span className="el-list__sub">
                    <i className="el-dot" data-field={c.field} /> {c.field} · {formatTime(c.duration)}
                  </span>
                </span>
                <span className="el-list__cpe">{formatHours(c.credits)} CPE</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
