import { Button } from "@base-ui/react/button";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { formatTime } from "../domain/courses.ts";
import type { Audio, Segment, Timing } from "../domain/types.ts";

/**
 * Sets when each transcript segment starts. Play the audio and press Mark as each segment begins, or type or nudge a
 * time. With automatic alignment set up on the server, Align fills every start in one go for checking here.
 */
export function TimingEditor({ courseId, audio, segments, timing, aligner, onSave }: {
  courseId: string;
  audio: Audio;
  segments: readonly Segment[];
  timing: Timing | null;
  aligner: string | null;
  onSave: (t: Timing) => Promise<void>;
}) {
  const fits = timing !== null && timing.segments.length === segments.length && Math.abs(timing.duration - audio.duration) <= 1;
  const [starts, setStarts] = useState<number[]>(() => (fits ? timing.segments.map((s) => s.start) : segments.map((_, i) => (i === 0 ? 0 : NaN))));
  const [next, setNext] = useState(() => {
    const unset = starts.findIndex((s) => Number.isNaN(s));
    return unset < 0 ? segments.length : unset;
  });
  const [now, setNow] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const el = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const a = el.current;
    if (!a) return;
    const tick = () => setNow(a.currentTime);
    a.addEventListener("timeupdate", tick);
    return () => a.removeEventListener("timeupdate", tick);
  }, []);

  const set = (i: number, t: number) => setStarts((s) => s.map((v, j) => (j === i ? Math.max(0, Math.min(audio.duration, Math.round(t * 100) / 100)) : v)));
  const mark = () => {
    if (next >= segments.length) return;
    set(next, el.current?.currentTime ?? now);
    setNext(next + 1);
  };
  const playFrom = (t: number) => {
    const a = el.current;
    if (!a || Number.isNaN(t)) return;
    a.currentTime = t;
    void a.play();
  };

  const problem = starts.some((s) => Number.isNaN(s))
    ? "Every segment needs a start."
    : starts.some((s, i) => i > 0 && s < starts[i - 1]!)
      ? "Starts must go forward: each segment after the one above it."
      : null;

  async function save() {
    if (problem) return;
    setBusy(true);
    setMessage(null);
    try {
      await onSave({ duration: audio.duration, segments: starts.map((start, i) => ({ start, end: starts[i + 1] ?? audio.duration })) });
      setMessage("Timings saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function align() {
    setBusy(true);
    setMessage(null);
    try {
      const t = await api<Timing>("POST", `/api/studio/courses/${courseId}/align`);
      setStarts(t.segments.map((s) => s.start));
      setNext(segments.length);
      setMessage(`Aligned with ${aligner}. Check a few starts, then save.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Alignment failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-timing" data-test="timing">
      <audio ref={el} src={audio.url} controls preload="metadata" className="studio-audio" />
      <div className="row">
        <Button className="pill pill--cpe" onClick={mark} disabled={next >= segments.length} data-test="mark">
          Mark segment {Math.min(next, segments.length - 1) + 1} at {formatTime(now)}
        </Button>
        {aligner ? (
          <Button className="pill pill--ghost" onClick={align} disabled={busy} data-test="align">
            Align automatically
          </Button>
        ) : (
          <span className="muted">Automatic alignment is not set up, so set starts by hand.</span>
        )}
      </div>
      <ol className="studio-list">
        {segments.map((seg, i) => (
          <li key={i} className={`studio-timing__row${i === next ? " is-next" : ""}`}>
            <input
              className="input studio-time"
              type="number"
              step="0.1"
              min={0}
              max={audio.duration}
              aria-label={`Start of segment ${i + 1}, in seconds`}
              value={Number.isNaN(starts[i]!) ? "" : starts[i]}
              onChange={(e) => set(i, e.target.value === "" ? NaN : Number(e.target.value))}
              data-test={`start-${i}`}
            />
            <Button className="textbtn" onClick={() => set(i, el.current?.currentTime ?? now)}>
              Now
            </Button>
            <Button className="textbtn" onClick={() => playFrom(starts[i]!)} disabled={Number.isNaN(starts[i]!)}>
              Play
            </Button>
            <span className="studio-timing__text">
              <strong>{seg.speaker}</strong> {seg.text.slice(0, 120)}
              {seg.text.length > 120 ? "…" : ""}
            </span>
          </li>
        ))}
      </ol>
      {problem && <p className="notice">{problem}</p>}
      {message && <p className="muted" role="status">{message}</p>}
      <Button className="pill pill--ink" onClick={save} disabled={busy || problem !== null} data-test="save-timing">
        Save timings
      </Button>
    </div>
  );
}
