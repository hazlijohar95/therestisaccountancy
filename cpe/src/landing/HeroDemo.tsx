import { Cover } from "../components/Cover.tsx";
import { Check, Pause, Play } from "../components/Icons.tsx";
import { Ring } from "../components/Ring.tsx";
import { Waveform } from "../components/Waveform.tsx";
import { formatHours, formatTime } from "../domain/courses.ts";
import { LISTEN_THRESHOLD } from "../domain/progress.ts";
import type { Course } from "../domain/types.ts";
import { demoQuestion } from "./demo.ts";
import { Bar, Collapse, Roll, Stage, States, Window, type Act } from "../stageshow/index.ts";

/**
 * The credit path on the real course page: the last review question comes up, the cursor answers it,
 * the episode finishes, the assessment passes and the hour lands in the ledger.
 * The course and its timings are real. The question is a demo one that restates the episode (see demo.ts), and the
 * ledger's opening balance is an example.
 */

type S = {
  t: number;
  playing: boolean;
  question: boolean;
  picked: boolean;
  answered: number;
  passed: boolean;
  posted: boolean;
};

/** The example ledger the hour lands in, labelled as an example on screen. */
const CYCLE = { before: 23, required: 40 };
const EARLIER = { title: "Scepticism when evidence is generated", hours: 0.5 };

const REST = { wide: { x: 330, y: 250 }, compact: { x: 220, y: 196 } };

function story(course: Course) {
  const last = course.checkpoints.length - 1;
  const cpAt = course.checkpointTimes[last]!;
  const startAt = Math.max(0, cpAt - course.duration * 0.06);
  const initial: S = { t: startAt, playing: false, question: false, picked: false, answered: last, passed: false, posted: false };
  const poster: S = { t: course.duration, playing: false, question: false, picked: true, answered: last + 1, passed: true, posted: true };

  /** Moves the playhead from where it is to `to` over `ms`, a frame at a time. */
  async function listen(a: Act<S>, from: number, to: number, ms: number) {
    const steps = Math.max(1, Math.round(ms / 40));
    for (let i = 1; i <= steps; i++) {
      a.put({ t: from + ((to - from) * i) / steps });
      await a.wait(40);
    }
  }

  async function script(a: Act<S>) {
    await a.wait(700);
    await a.click("play");
    await a.set({ playing: true });
    await listen(a, startAt, cpAt, 1600);

    // The review question interrupts playback, as it does in the app.
    await a.set({ playing: false, question: true });
    await a.wait(900);
    await a.click("right");
    await a.set({ picked: true, answered: last + 1 });
    await a.wait(1100);
    await a.set({ question: false });
    await a.wait(250);
    await a.move("rest");

    await a.set({ playing: true });
    await listen(a, cpAt, course.duration, 1500);
    await a.set({ playing: false });
    await a.wait(500);

    await a.click("assess");
    await a.set({ passed: true });
    await a.wait(700);
    await a.set({ posted: true });
    await a.move("rest");
    await a.wait(2400);
  }

  return { initial, poster, script, prompt: demoQuestion.prompt, options: demoQuestion.options, answer: demoQuestion.answer, total: course.checkpoints.length };
}

export function HeroDemo({ course }: { course: Course }) {
  const s0 = story(course);
  return (
    <Stage
      width={1000}
      height={540}
      compact={{ below: 640, width: 358, height: 580 }}
      initial={s0.initial}
      poster={s0.poster}
      script={s0.script}
      play="once"
      cursor={{ at: REST, ripple: true }}
      tokens={{ "--ss-font": "var(--font-sans)", "--ss-accent": "var(--cpe)" }}
      className="hstage"
    >
      {(s, _rect, layout) => {
        const heard = s.t / course.duration;
        const ready = heard >= LISTEN_THRESHOLD && s.answered === s0.total;
        const total = CYCLE.before + (s.posted ? course.credits : 0);
        const compact = layout === "compact";
        return (
          <>
            <Window url="cpe.therestisaccountancy.com" urlShape="pill" className="hs-window">
              <div className="hs-page">
                <div className="hs-head">
                  <span className="hs-cover">
                    <Cover course={course} size="sm" />
                  </span>
                  <div className="hs-headtext">
                    <div className="hs-eyebrow">
                      <i data-field={course.field} /> {course.field} · {course.level}
                    </div>
                    <div className="hs-title">{course.title}</div>
                    {!compact && (
                      <div className="hs-meta">
                        {course.show.title} · {formatTime(course.duration)} · {formatHours(course.credits)} CPE
                      </div>
                    )}
                  </div>
                </div>

                <div className="hs-actions">
                  <span className="hs-play" data-target="play" data-cursor="hand" data-on={s.playing || undefined}>
                    <States value={s.playing ? "pause" : "play"} states={{ play: <Play width={20} height={20} />, pause: <Pause width={20} height={20} /> }} />
                  </span>
                  <span className="hs-assess" data-target="assess" data-cursor="hand" data-show={ready || s.passed || undefined} data-done={s.passed || undefined}>
                    {s.passed && <Check width={16} height={16} />}
                    <Roll variant="fade">{s.passed ? "Passed · Certificate" : "Take the assessment"}</Roll>
                  </span>
                </div>

                <div className="hs-steps">
                  <Step label="Listen" value={`${Math.floor(heard * 100)}%`} fill={Math.min(1, heard / LISTEN_THRESHOLD)} done={heard >= LISTEN_THRESHOLD} />
                  <Step label="Review" value={`${s.answered}/${s0.total}`} fill={s.answered / s0.total} done={s.answered === s0.total} />
                  {!compact && <Step label="Assessment" value={s.passed ? "Passed" : "70% to pass"} fill={s.passed ? 1 : 0} done={s.passed} />}
                  {!compact && <Step label="Certificate" value={s.passed ? "Issued" : ""} fill={s.passed ? 1 : 0} done={s.passed} />}
                </div>

                <div className="hs-wave">
                  <Waveform course={course} time={s.t} ranges={[[0, s.t]]} answered={Array.from({ length: s.answered }, (_, i) => i)} />
                  <div className="hs-wavefoot">
                    <span>{formatTime(s.t)}</span>
                    <span>{formatTime(course.duration)}</span>
                  </div>
                </div>

                <div className="hs-filler" aria-hidden>
                  <Bar w="72%" h={8} tone={2} />
                  <Bar w="58%" h={8} tone={2} />
                  <Bar w="66%" h={8} tone={2} />
                </div>
              </div>
            </Window>

            <div className="hs-question" data-show={s.question || undefined} role="presentation">
              <div className="hs-qlabel">
                Review question {s0.total} of {s0.total}
              </div>
              <div className="hs-qprompt">{s0.prompt}</div>
              <div className="hs-options">
                {s0.options.map((o, i) => {
                  const right = i === s0.answer;
                  return (
                    <span key={o} className="hs-option" data-target={right ? "right" : undefined} data-cursor={right ? "hand" : undefined} data-right={right && s.picked ? true : undefined}>
                      <i />
                      {o}
                      {right && <Check width={16} height={16} style={{ visibility: s.picked ? "visible" : "hidden" }} />}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="hs-ledger">
              <div className="hs-lhead">
                <Ring slices={[{ value: total, tone: "var(--cpe)" }]} total={CYCLE.required} size={52} stroke={6} />
                <div>
                  <div className="hs-lcap">This cycle · example</div>
                  <div className="hs-ltotal">
                    <Roll delay={350}>{formatHours(total)}</Roll>
                    <span> of {CYCLE.required}h</span>
                  </div>
                </div>
              </div>
              <Collapse open={s.posted} reveal="drop">
                <div className="hs-lrow hs-lrow--new">
                  <span>{course.title}</span>
                  <b>+{formatHours(course.credits)}h</b>
                </div>
              </Collapse>
              <div className="hs-lrow">
                <span>{EARLIER.title}</span>
                <b>{formatHours(EARLIER.hours)}h</b>
              </div>
            </div>

            <span data-target="rest" className="hs-rest" style={{ left: REST[layout].x, top: REST[layout].y }} />
          </>
        );
      }}
    </Stage>
  );
}

function Step({ label, value, fill, done }: { label: string; value: string; fill: number; done: boolean }) {
  return (
    <div className="hs-step" data-done={done || undefined}>
      <span className="hs-bar">
        <span style={{ transform: `scaleX(${fill})` }} />
      </span>
      <span className="hs-slabel">
        {done && <Check width={13} height={13} />}
        {label}
      </span>
      <span className="hs-svalue">{value}</span>
    </div>
  );
}
