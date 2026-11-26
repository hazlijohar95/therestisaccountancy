import { Button } from "@base-ui/react/button";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Arrow, Check, Close } from "../components/Icons.tsx";
import type { Graded } from "../domain/api.ts";
import { formatHours, PASS_MARK } from "../domain/courses.ts";
import { phaseOf } from "../domain/progress.ts";
import type { Course, PublicQuestion } from "../domain/types.ts";
import { Link, navigate } from "../router.tsx";
import { useActions, useAppState, useCatalogue } from "../state.tsx";
import { NotFound } from "./NotFound.tsx";

const LETTERS = ["A", "B", "C", "D"];

/**
 * One sitting, opened on the server: each question with its options in an order the server chose. The app sends
 * back positions; the server maps them to answers and grades. Answers arrive only with the result.
 */
type Stage =
  | { kind: "intro" }
  | { kind: "asking"; sittingId: string; items: PublicQuestion[]; index: number; picks: (number | null)[] }
  | { kind: "done"; graded: Graded };

export function Assessment({ id }: { id: string }) {
  const { courseById, loaded } = useCatalogue();
  const course = courseById(id);
  if (!course) return loaded ? <NotFound /> : null;
  return <AssessmentView course={course} />;
}

function AssessmentView({ course }: { course: Course }) {
  const state = useAppState();
  const actions = useActions();
  const phase = phaseOf(state, course);
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  const [name, setName] = useState(state.learner);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
    if (n >= 0 && n < asking.items[asking.index]!.options.length) choose(n);
    const onControl = e.target instanceof HTMLElement && e.target.closest("a, button") !== null;
    if (e.key === "Enter" && !onControl && asking.picks[asking.index] !== null) {
      e.preventDefault();
      next();
    }
  };

  if ((phase.kind === "new" || phase.kind === "listening") && stage.kind !== "done") {
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

  /** Runs a server call, keeping the screen still while it is out and saying plainly if it fails. */
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await task();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn’t go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function start() {
    void run(async () => {
      if (!alreadyCertified && name.trim() && name.trim() !== state.learner) await actions.setName(name.trim());
      const sitting = await actions.sit(course);
      setStage({ kind: "asking", sittingId: sitting.id, items: sitting.questions, index: 0, picks: sitting.questions.map(() => null) });
    });
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
    void run(async () => {
      const graded = await actions.submit(course, asking.sittingId, asking.picks);
      setStage({ kind: "done", graded });
      window.scrollTo(0, 0);
    });
  }

  if (stage.kind === "intro") {
    const needed = Math.ceil(course.quizLength * PASS_MARK);
    return (
      <div className="page narrow assess">
        <p className="eyebrow">Assessment · {course.title}</p>
        <h1 className="display" ref={heading} tabIndex={-1}>
          Prove it.
        </h1>
        <ul className="ledgerlist">
          <li><span>Questions</span><span className="tnum">{course.quizLength}</span></li>
          <li><span>To pass</span><span className="tnum">{needed} of {course.quizLength} · 70%</span></li>
          <li><span>Time limit</span><span className="tnum">None</span></li>
          <li><span>Retakes</span><span className="tnum">Unlimited</span></li>
        </ul>
        {course.quizLength === 3 && (
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
        {problem && <p className="notice" role="alert">{problem}</p>}
        <Button className="pill pill--cpe" onClick={start} disabled={busy || (!alreadyCertified && !name.trim())} data-test="begin">
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
          {it.prompt}
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
          {it.options.map((option, i) => (
            <label key={option} className={`option${pick === i ? " option--picked" : " option--idle"}`} data-test={`answer-${i}`}>
              <Radio.Root value={i} className="option__key">
                {LETTERS[i]}
              </Radio.Root>
              <span>{option}</span>
            </label>
          ))}
        </RadioGroup>
        {problem && <p className="notice" role="alert">{problem}</p>}
        <div className="assess__nav">
          <Button className="pill pill--ghost" disabled={stage.index === 0} onClick={() => setStage({ ...stage, index: stage.index - 1 })}>
            Back
          </Button>
          <span className="muted tnum kbd-hint">A–D to answer · Enter to continue</span>
          <Button className="pill pill--cpe" disabled={pick === null || busy} onClick={next} data-test="next">
            {stage.index === stage.items.length - 1 ? "Submit" : "Next"} <Arrow />
          </Button>
        </div>
      </div>
    );
  }

  const { graded } = stage;
  const total = graded.total;
  const passed = graded.passed;
  const certificateId = graded.certificate?.id ?? (phase.kind === "certified" ? phase.certificate.id : null);
  return (
    <div className="page narrow assess">
      <div className="result">
        <div>
          <p className="eyebrow">{course.title}</p>
          <h1 className="result__score" ref={heading} tabIndex={-1} aria-label={`${graded.correct} of ${total} correct`}>
            {graded.correct}
            <span>/{total}</span>
          </h1>
          <p className="lead">{Math.round((graded.correct / total) * 100)}% · 70% needed</p>
        </div>
        <div className={`stamp ${passed ? "stamp--pass" : "stamp--fail"}`}>{passed ? "Passed" : "Not yet"}</div>
      </div>
      {passed ? (
        <div className="posted" role="status">
          <Check />{" "}
          {graded.certificate ? `${formatHours(course.credits)} CPE posted to your ledger` : "Already on your ledger. Retakes don’t post again."}
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
        {graded.review.map((it, i) => {
          const right = it.right;
          return (
            <li key={i} className={right ? "review--right" : "review--wrong"}>
              <p className="review__q">{it.prompt}</p>
              <p className="review__pick">
                {right ? <Check width={16} height={16} /> : <Close width={16} height={16} />} You answered: {it.picked === null ? "—" : it.options[it.picked]}
              </p>
              {!right && it.answer !== null && <p>Answer: {it.options[it.answer]}</p>}
              {it.why !== null && <p className="muted">{it.why}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
