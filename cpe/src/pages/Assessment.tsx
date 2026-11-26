import { Button } from "@base-ui/react/button";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Arrow, Check, Close } from "../components/Icons.tsx";
import { courseById, formatHours, PASS_MARK } from "../domain/courses.ts";
import { newCertificateId, phaseOf } from "../domain/progress.ts";
import type { Course, Question } from "../domain/types.ts";
import { Link, navigate } from "../router.tsx";
import { useAppState, useDispatch } from "../state.tsx";
import { NotFound } from "./NotFound.tsx";

const LETTERS = ["A", "B", "C", "D"];

/** One sitting: each question with its options in a fresh order, mapped back to the source answer. */
interface Item {
  q: Question;
  order: number[];
}

type Stage =
  | { kind: "intro" }
  | { kind: "asking"; items: Item[]; index: number; picks: (number | null)[] }
  | { kind: "done"; items: Item[]; picks: number[]; correct: number; certificateId: string | null };

function shuffle<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const sit = (course: Course): Item[] => course.quiz.map((q) => ({ q, order: shuffle(q.options.map((_, i) => i)) }));

export function Assessment({ id }: { id: string }) {
  const course = courseById(id);
  if (!course) return <NotFound />;
  return <AssessmentView course={course} />;
}

function AssessmentView({ course }: { course: Course }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const phase = phaseOf(state, course);
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  const [name, setName] = useState(state.learner);

  const asking = stage.kind === "asking" ? stage : null;
  const alreadyCertified = phase.kind === "certified";
  const heading = useRef<HTMLHeadingElement>(null);

  // Each new step is a new view: move focus to its heading so screen readers announce it.
  useEffect(() => {
    heading.current?.focus();
  }, [stage.kind, asking?.index]);

  // Shortcuts are scoped to the question view. Enter on a button or link keeps that control's own meaning.
  const onAnswerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!asking || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = "1234".indexOf(e.key) >= 0 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
    if (n >= 0 && n < asking.items[asking.index]!.order.length) choose(n);
    const onControl = e.target instanceof HTMLElement && e.target.closest("a, button") !== null;
    if (e.key === "Enter" && !onControl && asking.picks[asking.index] !== null) {
      e.preventDefault();
      next();
    }
  };

  if (phase.kind === "new" || phase.kind === "listening") {
    return (
      <div className="page narrow">
        <p className="eyebrow">Assessment · {course.title}</p>
        <h1 className="display" ref={heading} tabIndex={-1}>
          Not open yet.
        </h1>
        <p className="lead">Hear the whole episode and answer its review questions first.</p>
        <Link className="pill pill--cpe" href={`/course/${course.id}`}>
          Back to listening <Arrow />
        </Link>
      </div>
    );
  }

  function start() {
    if (!alreadyCertified && name.trim() && name.trim() !== state.learner) dispatch({ type: "learner", name: name.trim() });
    const items = sit(course);
    setStage({ kind: "asking", items, index: 0, picks: items.map(() => null) });
  }

  function choose(displayIndex: number) {
    if (!asking) return;
    const picks = [...asking.picks];
    picks[asking.index] = displayIndex;
    setStage({ ...asking, picks });
  }

  function next() {
    if (!asking) return;
    if (asking.index < asking.items.length - 1) {
      setStage({ ...asking, index: asking.index + 1 });
      return;
    }
    const picks = asking.picks.map((p) => p ?? -1);
    const correct = asking.items.filter((it, i) => it.order[picks[i]!] === it.q.answer).length;
    const at = new Date();
    const passed = correct / asking.items.length >= PASS_MARK;
    const certificateId = passed && phase.kind !== "certified" ? newCertificateId(course, at) : null;
    dispatch({
      type: "attempt",
      courseId: course.id,
      correct,
      total: asking.items.length,
      at: at.toISOString(),
      certificateId: certificateId ?? "",
    });
    setStage({ kind: "done", items: asking.items, picks, correct, certificateId });
    window.scrollTo(0, 0);
  }

  if (stage.kind === "intro") {
    const needed = Math.ceil(course.quiz.length * PASS_MARK);
    return (
      <div className="page narrow assess">
        <p className="eyebrow">Assessment · {course.title}</p>
        <h1 className="display" ref={heading} tabIndex={-1}>
          Prove it.
        </h1>
        <ul className="ledgerlist">
          <li><span>Questions</span><span className="tnum">{course.quiz.length}</span></li>
          <li><span>To pass</span><span className="tnum">{needed} of {course.quiz.length} · 70%</span></li>
          <li><span>Time limit</span><span className="tnum">None</span></li>
          <li><span>Retakes</span><span className="tnum">Unlimited</span></li>
        </ul>
        {course.quiz.length === 3 && (
          <p className="notice">Three questions, so 70% means all three.</p>
        )}
        {alreadyCertified ? (
          <p className="notice">You’ve already passed. Retakes are for practice and don’t post again.</p>
        ) : (
          <Field.Root className="field">
            <Field.Label className="label">Name on your certificate</Field.Label>
            <Input value={name} onValueChange={setName} autoComplete="name" data-test="name" />
          </Field.Root>
        )}
        <Button className="pill pill--cpe" onClick={start} disabled={!alreadyCertified && !name.trim()} data-test="begin">
          Begin <Arrow />
        </Button>
      </div>
    );
  }

  if (stage.kind === "asking") {
    const it = stage.items[stage.index]!;
    const pick = stage.picks[stage.index];
    return (
      <div className="page narrow assess" onKeyDown={onAnswerKey}>
        <div className="ticks" aria-hidden>
          {stage.items.map((_, i) => (
            <span key={i} className={`tick${i < stage.index ? " tick--done" : i === stage.index ? " tick--now" : ""}`} />
          ))}
        </div>
        <p className="eyebrow">
          Question {stage.index + 1} of {stage.items.length}
        </p>
        <h1 className="assess__q" id="assess-q" ref={heading} tabIndex={-1}>
          {it.q.prompt}
        </h1>
        <RadioGroup
          className="options"
          key={stage.index}
          value={pick}
          onValueChange={(v) => {
            if (v !== null) choose(v);
          }}
          aria-labelledby="assess-q"
        >
          {it.order.map((src, i) => (
            <label key={src} className={`option${pick === i ? " option--picked" : " option--idle"}`} data-test={`answer-${i}`}>
              <Radio.Root value={i} className="option__key">
                {LETTERS[i]}
              </Radio.Root>
              <span>{it.q.options[src]}</span>
            </label>
          ))}
        </RadioGroup>
        <div className="assess__nav">
          <Button className="pill pill--ghost" disabled={stage.index === 0} onClick={() => setStage({ ...stage, index: stage.index - 1 })}>
            Back
          </Button>
          <span className="muted tnum kbd-hint">A–D to answer · Enter to continue</span>
          <Button className="pill pill--cpe" disabled={pick === null} onClick={next} data-test="next">
            {stage.index === stage.items.length - 1 ? "Submit" : "Next"} <Arrow />
          </Button>
        </div>
      </div>
    );
  }

  const total = stage.items.length;
  const passed = stage.correct / total >= PASS_MARK;
  const certificateId = stage.certificateId ?? (phase.kind === "certified" ? phase.certificate.id : null);
  return (
    <div className="page narrow assess">
      <div className="result">
        <div>
          <p className="eyebrow">{course.title}</p>
          <h1 className="result__score" ref={heading} tabIndex={-1} aria-label={`${stage.correct} of ${total} correct`}>
            {stage.correct}
            <span>/{total}</span>
          </h1>
          <p className="lead">{Math.round((stage.correct / total) * 100)}% · 70% needed</p>
        </div>
        <div className={`stamp ${passed ? "stamp--pass" : "stamp--fail"}`}>{passed ? "Passed" : "Not yet"}</div>
      </div>
      {passed ? (
        <div className="posted" role="status">
          <Check />{" "}
          {stage.certificateId ? `${formatHours(course.credits)} CPE posted to your ledger` : "Already on your ledger. Retakes don’t post again."}
        </div>
      ) : (
        <p className="lead">Check the explanations, then retake. Options reshuffle.</p>
      )}
      <div className="assess__nav">
        {passed && certificateId ? (
          <>
            <Link className="pill pill--ghost" href="/ledger">Ledger</Link>
            <Button className="pill pill--cpe" onClick={() => navigate(`/certificate/${certificateId}`)} data-test="to-certificate">
              View certificate <Arrow />
            </Button>
          </>
        ) : (
          <>
            <Link className="pill pill--ghost" href={`/course/${course.id}`}>Re-listen</Link>
            <Button className="pill pill--cpe" onClick={start} data-test="retake">
              Retake <Arrow />
            </Button>
          </>
        )}
      </div>
      <h2 className="label">Your answers</h2>
      <ol className="review">
        {stage.items.map((it, i) => {
          const chosen = it.order[stage.picks[i]!];
          const right = chosen === it.q.answer;
          return (
            <li key={i} className={right ? "review--right" : "review--wrong"}>
              <p className="review__q">{it.q.prompt}</p>
              <p className="review__pick">
                {right ? <Check width={16} height={16} /> : <Close width={16} height={16} />} You answered: {chosen === undefined ? "—" : it.q.options[chosen]}
              </p>
              {!right && <p>Answer: {it.q.options[it.q.answer]}</p>}
              <p className="muted">{it.q.why}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
