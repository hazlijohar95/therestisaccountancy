import { useEffect, useRef } from "react";
import { Cover } from "../components/Cover.tsx";
import { Arrow, Check, Lock } from "../components/Icons.tsx";
import { PlayButton } from "../components/PlayButton.tsx";
import { Button } from "@base-ui/react/button";
import { Progress } from "@base-ui/react/progress";
import { Scrubber } from "../components/Scrubber.tsx";
import { formatHours, formatTime } from "../domain/courses.ts";
import { coverage, LISTEN_THRESHOLD, phaseOf, progressOf, type Phase } from "../domain/progress.ts";
import type { Course } from "../domain/types.ts";
import { usePlayer } from "../player.tsx";
import { Link, navigate } from "../router.tsx";
import { useAppState, useCatalogue } from "../state.tsx";
import { NotFound } from "./NotFound.tsx";

export function CoursePage({ id }: { id: string }) {
  const { courseById, loaded } = useCatalogue();
  const course = courseById(id);
  if (!course) return loaded ? <NotFound /> : null;
  return <CourseView course={course} />;
}

type StepState = "done" | "now" | "locked";

function Steps({ course, phase, heard, answered }: { course: Course; phase: Phase; heard: number; answered: number }) {
  const listened = heard >= LISTEN_THRESHOLD;
  const reviewed = answered === course.checkpoints.length;
  const passed = phase.kind === "certified";
  const steps: { label: string; value: string; fill: number; state: StepState }[] = [
    { label: "Listen", value: `${Math.floor(heard * 100)}%`, fill: Math.min(1, heard / LISTEN_THRESHOLD), state: listened ? "done" : "now" },
    { label: "Review", value: `${answered}/${course.checkpoints.length}`, fill: answered / course.checkpoints.length, state: reviewed ? "done" : "now" },
    { label: "Assessment", value: passed ? "Passed" : "70% to pass", fill: passed ? 1 : 0, state: passed ? "done" : phase.kind === "ready" ? "now" : "locked" },
    { label: "Certificate", value: passed ? "Issued" : "", fill: passed ? 1 : 0, state: passed ? "done" : "locked" },
  ];
  return (
    <ol className="steps" aria-label="Credit path" data-test="steps">
      {steps.map((s) => (
        <li key={s.label} className={`step step--${s.state}`}>
          <Progress.Root value={Math.round(s.fill * 100)} aria-label={s.label} className="step__progress">
            <Progress.Track className="step__bar">
              <Progress.Indicator className="step__fill" />
            </Progress.Track>
          </Progress.Root>
          <span className="step__label">
            {s.state === "done" ? <Check width={14} height={14} /> : s.state === "locked" ? <Lock width={12} height={12} /> : null}
            {s.label}
          </span>
          <span className="step__value mono">{s.value}</span>
        </li>
      ))}
    </ol>
  );
}

export function CourseView({ course, preview = false }: { course: Course; preview?: boolean }) {
  const state = useAppState();
  const player = usePlayer();
  const active = player.course?.id === course.id;
  const p = progressOf(state, course);
  const time = active ? player.time : p.position;
  const heard = coverage(p, course);
  // Audio behind the playhead that was never heard shows as skipped in the waveform.
  const heardBehind = p.ranges.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, time) - a), 0);
  const skipped = heardBehind < time - 2;
  const phase = phaseOf(state, course);
  const current = course.segments.findIndex((s, i) => time >= s.start && time < (course.segments[i + 1]?.start ?? Infinity));
  const missed = course.checkpoints
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => !p.checkpoints.includes(i) && course.checkpointTimes[i]! < time - 1);
  const seek = (t: number) => (active ? player.seek(t) : player.play(course, t, { preview }));

  return (
    <div className="view view--course">
      <header className="hero-head">
        <Cover course={course} size="lg" />
        <div className="hero-head__text">
          <p className="eyebrow" data-field={course.field}>
            <i className="dot" /> {course.field} · {course.level}
          </p>
          <h1 className="hero-head__title">{course.title}</h1>
          <p className="hero-head__meta">
            <Link href={`/show/${course.show.id}`}>{course.show.title}</Link> · {formatTime(course.duration)} · {formatHours(course.credits)} CPE
          </p>
        </div>
      </header>

      <div className="actions">
        <PlayButton course={course} size="lg" preview={preview} />
        {phase.kind === "ready" && (
          <Button className="pill pill--cpe" onClick={() => navigate(`/course/${course.id}/assessment`)} data-test="take-assessment">
            Take the assessment <Arrow width={18} height={18} />
          </Button>
        )}
        {phase.kind === "certified" && (
          <Link className="pill pill--cpe" href={`/certificate/${phase.certificate.id}`} data-test="view-certificate">
            <Check width={18} height={18} /> Certificate
          </Link>
        )}
        {phase.kind !== "ready" && phase.kind !== "certified" && (
          <span className="actions__hint">
            {active && player.playing
              ? "Now playing"
              : phase.kind === "new" || p.position < 1
                ? "Hear it all, answer as you go, then pass the assessment."
                : `Resume at ${formatTime(p.position)}`}
          </span>
        )}
      </div>

      <Steps course={course} phase={phase} heard={heard} answered={p.checkpoints.length} />

      <section className="wavecard" aria-label="Progress through the episode">
        <Scrubber course={course} time={time} ranges={p.ranges} answered={p.checkpoints} onSeek={seek} />
        <div className="wavecard__foot">
          <span className="mono">{formatTime(time)}</span>
          <ul className="key">
            <li><i className="key__heard" />Heard</li>
            {skipped && <li><i className="key__skipped" />Skipped</li>}
            <li><i className="key__cp" />Review question</li>
          </ul>
          <span className="mono">{formatTime(course.duration)}</span>
        </div>
        {active && player.queued.length > 0 && player.pending === null && (
          <div className="notice" data-test="queued">
            {player.queued.length === 1 ? "One review question is waiting" : `${player.queued.length} review questions are waiting`} for the end of the episode.
            <Button className="textbtn" onClick={player.answerQueued} data-test="answer-queued">
              Answer now
            </Button>
          </div>
        )}
        {missed.length > 0 && !(active && player.queued.length > 0) && (
          <div className="notice" data-test="missed">
            Answer skipped review questions to unlock the assessment.
            {missed.map(({ c, i }) => (
              <Button key={i} className="textbtn" onClick={() => player.play(course, course.segments[c.afterSegment]!.start, { preview })}>
                Back to review question {i + 1}
              </Button>
            ))}
          </div>
        )}
      </section>

      <div className="course-body">
        <Transcript course={course} current={active ? current : -1} onPlay={(t) => player.play(course, t, { preview })} />
        <aside className="facts">
          <h2 className="eyebrow">You’ll learn to</h2>
          <ul className="learn">
            {course.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <h2 className="eyebrow">Terms</h2>
          <dl className="terms">
            {course.glossary.map((g) => (
              <div key={g.term}>
                <dt>{g.term}</dt>
                <dd>{g.meaning}</dd>
              </div>
            ))}
          </dl>
          <dl className="specs">
            <div><dt>Delivery</dt><dd>Self-study, audio</dd></div>
            <div><dt>Prerequisites</dt><dd>None</dd></div>
            <div><dt>To pass</dt><dd>{course.quizLength} questions, 70%</dd></div>
          </dl>
          <p className="sample">Sample course · synthetic voice · credit not accredited</p>
        </aside>
      </div>
    </div>
  );
}

function Transcript({ course, current, onPlay }: { course: Course; current: number; onPlay: (t: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = box.current;
    const el = container?.querySelector<HTMLElement>(".lyric--now");
    if (!el || !container) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ top: el.offsetTop - container.clientHeight / 3, behavior: still ? "auto" : "smooth" });
  }, [current]);

  return (
    <section className={`lyrics${current < 0 ? " lyrics--idle" : ""}`} aria-label="Transcript">
      <div className="lyrics__scroll" ref={box}>
        {course.segments.map((s, i) => (
          <div key={i}>
            {s.chapter && <h3 className="lyrics__chapter">{s.chapter}</h3>}
            <Button
              className={`lyric${i === current ? " lyric--now" : i < current ? " lyric--past" : ""}`}
              onClick={() => onPlay(s.start)}
              data-test={`line-${i}`}
            >
              {s.text}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
