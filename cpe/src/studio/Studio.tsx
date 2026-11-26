import { Button } from "@base-ui/react/button";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { Arrow, Close, Plus } from "../components/Icons.tsx";
import type { StudioCourse, StudioIndex, StudioVersion } from "../domain/api.ts";
import { fields, formatHours, formatTime, playable } from "../domain/courses.ts";
import type { Checkpoint, CourseScript, Question, Show } from "../domain/types.ts";
import { CourseView } from "../pages/CoursePage.tsx";
import { Link, navigate } from "../router.tsx";
import { useSession } from "../state.tsx";
import { measure, upload } from "./media.ts";
import "./studio.css";
import { TimingEditor } from "./TimingEditor.tsx";

const LEVELS = ["Basic", "Intermediate", "Advanced"] as const;
const CREDITS = [0.5, 1, 1.5, 2] as const;
const MOTIFS = ["ledger", "dither", "stamp", "grid"] as const;
const LETTERS = ["A", "B", "C", "D"];

/** The Studio is for club admins. Everyone else is told so; the server refuses them anyway. */
export function Studio({ id }: { id: string | null }) {
  const session = useSession();
  if (session.status !== "member") return null;
  if (session.member.role !== "admin") {
    return (
      <div className="page narrow" data-test="studio-refused">
        <p className="eyebrow">Studio</p>
        <h1 className="display">Admins only.</h1>
        <p className="lead">The Studio is where club admins write and publish courses.</p>
        <Link className="pill pill--ghost" href="/home">
          Back to courses
        </Link>
      </div>
    );
  }
  if (id === null) return <StudioHome />;
  if (id === "new") return <NewCourse />;
  return <CourseEditor key={id} id={id} />;
}

function useLoad<T>(path: string): [T | null, string | null, (v: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<T>("GET", path).then(
      (v) => live && setValue(v),
      (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load."),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return [value, error, setValue];
}

function StudioHome() {
  const [index, error] = useLoad<StudioIndex>("/api/studio");
  if (error) return <p className="notice">{error}</p>;
  if (!index) return <div className="page" aria-busy="true" />;
  return (
    <div className="page studio" data-test="studio">
      <header className="libhead">
        <h1 className="pagetitle">Studio</h1>
        <Link className="pill pill--ink" href="/studio/new" data-test="new-course">
          <Plus width={18} height={18} /> New course
        </Link>
      </header>
      <p className="muted">
        Published versions never change. Editing a course starts a new draft version; listeners part-way through stay on theirs.{" "}
        {index.aligner ? `Timings can be aligned automatically (${index.aligner}).` : "Automatic alignment is not set up, so timings are set by hand."}
      </p>
      <ul className="studio-list">
        {index.courses.map((c) => (
          <li key={c.id} className="studio-card">
            <Link href={`/studio/${c.id}`} className="studio-card__title" data-test={`studio-${c.id}`}>
              {c.title}
            </Link>
            <span className="muted">
              {c.id} · {index.shows.find((s) => s.id === c.showId)?.title ?? c.showId}
            </span>
            <span className="row">
              {c.versions.map((v) => (
                <span key={v.version} className={`tag${v.status === "published" ? " tag--ink" : ""}`}>
                  v{v.version} {v.status}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const blankScript = (show: Show | undefined): CourseScript => ({
  id: "",
  showId: show?.id ?? "",
  title: "",
  dek: "",
  field: "Ethics",
  level: "Basic",
  credits: 1,
  motif: "ledger",
  published: new Date().toISOString().slice(0, 10),
  objectives: [],
  glossary: [],
  segments: [],
  checkpoints: [],
  quiz: [],
});

function NewCourse() {
  const [index] = useLoad<StudioIndex>("/api/studio");
  const [script, setScript] = useState<CourseScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (index && !script) setScript(blankScript(index.shows[0]));
  }, [index, script]);
  if (!index || !script) return <div className="page" aria-busy="true" />;
  const create = async () => {
    setError(null);
    try {
      await api<StudioCourse>("POST", "/api/studio/courses", { script });
      navigate(`/studio/${script.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not created.");
    }
  };
  return (
    <div className="page narrow studio" data-test="studio-new">
      <p className="eyebrow">Studio · New course</p>
      <h1 className="pagetitle">New course</h1>
      <TextField label="Course id (in its address, can’t change later)" value={script.id} onChange={(id) => setScript({ ...script, id })} test="course-id" placeholder="lease-accounting-basics" />
      <Details script={script} shows={index.shows} onChange={setScript} />
      {error && <p className="notice" role="alert">{error}</p>}
      <Button className="pill pill--cpe" onClick={create} data-test="create-course">
        Create draft <Arrow />
      </Button>
    </div>
  );
}

function CourseEditor({ id }: { id: string }) {
  const [view, error, setView] = useLoad<StudioCourse>(`/api/studio/courses/${id}`);
  const [script, setScript] = useState<CourseScript | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);

  useEffect(() => {
    if (view?.draft && !dirty) setScript(view.draft.script);
  }, [view, dirty]);

  if (error) return <p className="notice">{error}</p>;
  if (!view) return <div className="page" aria-busy="true" />;

  const run = async (task: () => Promise<StudioCourse | void>, done?: string) => {
    setStatus(null);
    try {
      const next = await task();
      if (next) setView(next);
      if (done) setStatus({ tone: "ok", text: done });
    } catch (e) {
      setStatus({ tone: "bad", text: e instanceof Error ? e.message : "That didn’t work." });
    }
  };

  const draft = view.draft;
  if (!draft || !script) {
    return (
      <div className="page narrow studio" data-test="studio-course">
        <p className="eyebrow">Studio · {id}</p>
        <h1 className="pagetitle">{view.live?.script.title ?? id}</h1>
        {view.live && <VersionFacts v={view.live} />}
        <p className="lead">Published versions are fixed. Editing starts version {(view.live?.version ?? 0) + 1} as a draft.</p>
        {status && <p className={status.tone === "bad" ? "notice" : "muted"}>{status.text}</p>}
        <Button className="pill pill--cpe" onClick={() => run(() => api<StudioCourse>("POST", `/api/studio/courses/${id}/draft`))} data-test="start-draft">
          Edit as a new version <Arrow />
        </Button>
      </div>
    );
  }

  const edit = (next: CourseScript) => {
    setScript(next);
    setDirty(true);
  };
  const saveScript = () =>
    run(async () => {
      const next = await api<StudioCourse>("PUT", `/api/studio/courses/${id}/draft`, { script });
      setDirty(false);
      return next;
    }, "Draft saved.");

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      setUploading(0);
      try {
        const { duration, peaks } = await measure(file);
        const url = await upload(id, file, setUploading);
        return await api<StudioCourse>("PUT", `/api/studio/courses/${id}/draft`, { audio: { url, duration, peaks } });
      } finally {
        setUploading(null);
      }
    }, "Audio uploaded. Set the timings again for the new audio.");
  };

  const previewCourse =
    draft.audio && draft.timing && draft.timing.segments.length === draft.script.segments.length
      ? playable(draft.script, draft.version, view.shows.find((s) => s.id === draft.script.showId) ?? view.shows[0]!, draft.audio, draft.timing)
      : null;

  return (
    <div className="page studio" data-test="studio-course">
      <header className="libhead">
        <div>
          <p className="eyebrow">
            Studio · {id} · draft v{draft.version}
            {view.live ? ` · live v${view.live.version}` : " · not yet published"}
          </p>
          <h1 className="pagetitle">{script.title || id}</h1>
        </div>
        <div className="row">
          <Button className="pill pill--ghost" onClick={() => setPreview(!preview)} disabled={!previewCourse || dirty} data-test="preview">
            {preview ? "Back to editing" : "Preview"}
          </Button>
          <Button
            className="pill pill--cpe"
            onClick={() => run(() => api<StudioCourse>("POST", `/api/studio/courses/${id}/publish`), `Version ${draft.version} is live.`)}
            disabled={dirty || view.problems.length > 0}
            data-test="publish"
          >
            Publish v{draft.version}
          </Button>
        </div>
      </header>
      {status && (
        <p className={status.tone === "bad" ? "notice" : "posted"} role="status" data-test="studio-status">
          {status.text}
        </p>
      )}
      {dirty && <p className="notice">Unsaved changes. Save the draft before previewing or publishing.</p>}
      {!dirty && view.problems.length > 0 && (
        <ul className="notice" data-test="problems">
          {view.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {preview && previewCourse ? (
        <div className="studio-preview" data-test="studio-preview">
          <CourseView course={previewCourse} preview />
        </div>
      ) : (
        <>
          <Section title="Details">
            <Details script={script} shows={view.shows} onChange={edit} />
          </Section>
          <Section title="You’ll learn to">
            <StringList items={script.objectives} onChange={(objectives) => edit({ ...script, objectives })} add="Add an objective" test="objective" />
          </Section>
          <Section title="Terms">
            <Glossary script={script} onChange={edit} />
          </Section>
          <Section title="Transcript">
            <Segments script={script} onChange={edit} />
          </Section>
          <Section title="Review questions">
            <p className="muted">They pause the episode at the end of the segment you place them after. Listeners answer until right; they teach, not grade.</p>
            <Questions items={script.checkpoints} segments={script.segments.length} onChange={(checkpoints) => edit({ ...script, checkpoints: checkpoints.map((c) => ({ ...c, afterSegment: "afterSegment" in c ? c.afterSegment : 0 })) })} review test="review" />
          </Section>
          <Section title="Assessment">
            <p className="muted">Graded on the server; 70% to pass. A half-credit course has 3 questions and a one-credit course 5.</p>
            <Questions items={script.quiz} segments={0} onChange={(quiz) => edit({ ...script, quiz })} test="quiz" />
          </Section>
          <div className="studio-save">
            <Button className="pill pill--ink" onClick={saveScript} disabled={!dirty} data-test="save-draft">
              Save draft
            </Button>
            <Button
              className="textbtn"
              onClick={() =>
                void run(async () => {
                  await api("DELETE", `/api/studio/courses/${id}/draft`);
                  setDirty(false);
                  navigate("/studio");
                })
              }
            >
              Discard draft
            </Button>
          </div>
          <Section title="Audio">
            {draft.audio ? (
              <p className="muted" data-test="audio-facts">
                {formatTime(draft.audio.duration)} · {draft.audio.url.startsWith("/audio/") ? "sample file" : "uploaded"}
              </p>
            ) : (
              <p className="muted">No audio yet.</p>
            )}
            <label className="field">
              <span className="label">{draft.audio ? "Replace the audio" : "Upload the audio"}</span>
              <input type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm,.aac,.flac" disabled={uploading !== null} onChange={(e) => onFile(e.target.files?.[0])} data-test="audio-file" />
            </label>
            {uploading !== null && <p className="muted" role="status">Uploading… {Math.round(uploading * 100)}%</p>}
          </Section>
          <Section title="Timings">
            {!draft.audio ? (
              <p className="muted">Upload the audio first.</p>
            ) : dirty ? (
              <p className="muted">Save the draft first, so timings match the transcript you saved.</p>
            ) : draft.script.segments.length === 0 ? (
              <p className="muted">Add the transcript first.</p>
            ) : (
              <TimingEditor
                key={`${draft.audio.url}:${draft.script.segments.length}`}
                courseId={id}
                audio={draft.audio}
                segments={draft.script.segments}
                timing={draft.timing}
                aligner={view.aligner}
                onSave={async (timing) => setView(await api<StudioCourse>("PUT", `/api/studio/courses/${id}/draft`, { timing }))}
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function VersionFacts({ v }: { v: StudioVersion }) {
  return (
    <ul className="ledgerlist">
      <li><span>Version</span><span className="tnum">v{v.version} · {v.status}</span></li>
      <li><span>Credit</span><span className="tnum">{formatHours(v.script.credits)} hours</span></li>
      <li><span>Audio</span><span className="tnum">{v.audio ? formatTime(v.audio.duration) : "none"}</span></li>
      <li><span>Questions</span><span className="tnum">{v.script.checkpoints.length} review · {v.script.quiz.length} assessment</span></li>
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="studio-section">
      <h2 className="label">{title}</h2>
      {children}
    </section>
  );
}

function TextField({ label, value, onChange, test, placeholder, long = false }: { label: string; value: string; onChange: (v: string) => void; test?: string; placeholder?: string; long?: boolean }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {long ? (
        <textarea className="input studio-textarea" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-test={test} />
      ) : (
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-test={test} />
      )}
    </label>
  );
}

function Choice<T extends string | number>({ label, value, options, onChange, show = String }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void; show?: (v: T) => string }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <select value={String(value)} onChange={(e) => onChange(options.find((o) => String(o) === e.target.value) ?? value)}>
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {show(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Details({ script, shows, onChange }: { script: CourseScript; shows: readonly Show[]; onChange: (s: CourseScript) => void }) {
  const showIds = shows.map((s) => s.id);
  return (
    <div className="studio-grid">
      <TextField label="Title" value={script.title} onChange={(title) => onChange({ ...script, title })} test="title" />
      <Choice label="Show" value={script.showId} options={showIds} onChange={(showId) => onChange({ ...script, showId })} show={(id) => shows.find((s) => s.id === id)?.title ?? id} />
      <div className="studio-wide">
        <TextField label="One-line summary" value={script.dek} onChange={(dek) => onChange({ ...script, dek })} test="dek" />
      </div>
      <Choice label="Field of study" value={script.field} options={fields} onChange={(field) => onChange({ ...script, field })} />
      <Choice label="Level" value={script.level} options={LEVELS} onChange={(level) => onChange({ ...script, level })} />
      <Choice label="Credit (hours)" value={script.credits} options={CREDITS} onChange={(credits) => onChange({ ...script, credits })} />
      <Choice label="Cover" value={script.motif} options={MOTIFS} onChange={(motif) => onChange({ ...script, motif })} />
      <label className="field">
        <span className="label">Published</span>
        <input className="input" type="date" value={script.published} onChange={(e) => onChange({ ...script, published: e.target.value })} />
      </label>
    </div>
  );
}

/** Moves item i by d places, for the ↑ and ↓ buttons. */
const move = <T,>(xs: readonly T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= xs.length) return [...xs];
  const out = [...xs];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

function RowTools({ i, n, onMove, onRemove, label }: { i: number; n: number; onMove: (d: number) => void; onRemove: () => void; label: string }) {
  return (
    <span className="row studio-tools">
      <Button className="textbtn" onClick={() => onMove(-1)} disabled={i === 0} aria-label={`Move ${label} up`}>
        ↑
      </Button>
      <Button className="textbtn" onClick={() => onMove(1)} disabled={i === n - 1} aria-label={`Move ${label} down`}>
        ↓
      </Button>
      <Button className="ghost-icon ghost-icon--sm" onClick={onRemove} aria-label={`Remove ${label}`}>
        <Close width={16} height={16} />
      </Button>
    </span>
  );
}

function StringList({ items, onChange, add, test }: { items: readonly string[]; onChange: (v: string[]) => void; add: string; test: string }) {
  return (
    <ol className="studio-list">
      {items.map((item, i) => (
        <li key={i} className="studio-row">
          <input className="input" value={item} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${test} ${i + 1}`} data-test={`${test}-${i}`} />
          <RowTools i={i} n={items.length} label={`${test} ${i + 1}`} onMove={(d) => onChange(move(items, i, d))} onRemove={() => onChange(items.filter((_, j) => j !== i))} />
        </li>
      ))}
      <li>
        <Button className="textbtn" onClick={() => onChange([...items, ""])} data-test={`add-${test}`}>
          <Plus width={16} height={16} /> {add}
        </Button>
      </li>
    </ol>
  );
}

function Glossary({ script, onChange }: { script: CourseScript; onChange: (s: CourseScript) => void }) {
  const items = script.glossary;
  const set = (glossary: { term: string; meaning: string }[]) => onChange({ ...script, glossary });
  return (
    <ol className="studio-list">
      {items.map((g, i) => (
        <li key={i} className="studio-row">
          <input className="input" value={g.term} placeholder="Term" onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)))} aria-label={`Term ${i + 1}`} />
          <input className="input" value={g.meaning} placeholder="Meaning" onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, meaning: e.target.value } : x)))} aria-label={`Meaning ${i + 1}`} />
          <RowTools i={i} n={items.length} label={`term ${i + 1}`} onMove={(d) => set(move(items, i, d))} onRemove={() => set(items.filter((_, j) => j !== i))} />
        </li>
      ))}
      <li>
        <Button className="textbtn" onClick={() => set([...items, { term: "", meaning: "" }])}>
          <Plus width={16} height={16} /> Add a term
        </Button>
      </li>
    </ol>
  );
}

/**
 * Transcript segments: who speaks and what they say, and where a chapter starts. Review questions point at segments
 * by position, so moving or removing a segment moves the questions placed after it with it.
 */
function Segments({ script, onChange }: { script: CourseScript; onChange: (s: CourseScript) => void }) {
  const segs = script.segments;
  const reindex = (map: (i: number) => number | null) =>
    script.checkpoints.flatMap((c) => {
      const at = map(c.afterSegment);
      return at === null ? [] : [{ ...c, afterSegment: at }];
    });
  return (
    <ol className="studio-list">
      {segs.map((s, i) => (
        <li key={i} className="studio-segment">
          <div className="studio-grid">
            <input className="input" value={s.speaker} placeholder="Speaker" onChange={(e) => onChange({ ...script, segments: segs.map((x, j) => (j === i ? { ...x, speaker: e.target.value } : x)) })} aria-label={`Speaker of segment ${i + 1}`} data-test={`speaker-${i}`} />
            <input
              className="input"
              value={s.chapter ?? ""}
              placeholder="Starts a chapter (optional)"
              onChange={(e) => onChange({ ...script, segments: segs.map((x, j) => (j === i ? withChapter(x, e.target.value) : x)) })}
              aria-label={`Chapter starting at segment ${i + 1}`}
            />
          </div>
          <textarea className="input studio-textarea" value={s.text} onChange={(e) => onChange({ ...script, segments: segs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} aria-label={`Text of segment ${i + 1}`} data-test={`segment-${i}`} />
          <RowTools
            i={i}
            n={segs.length}
            label={`segment ${i + 1}`}
            onMove={(d) => {
              const j = i + d;
              if (j < 0 || j >= segs.length) return;
              onChange({ ...script, segments: move(segs, i, d), checkpoints: reindex((at) => (at === i ? j : at === j ? i : at)) });
            }}
            onRemove={() => onChange({ ...script, segments: segs.filter((_, j) => j !== i), checkpoints: reindex((at) => (at === i ? null : at > i ? at - 1 : at)) })}
          />
        </li>
      ))}
      <li>
        <Button className="textbtn" onClick={() => onChange({ ...script, segments: [...segs, { speaker: segs[segs.length - 1]?.speaker === "Host" ? "Guest" : "Host", text: "" }] })} data-test="add-segment">
          <Plus width={16} height={16} /> Add a segment
        </Button>
      </li>
    </ol>
  );
}

const withChapter = (s: CourseScript["segments"][number], chapter: string) => {
  const { chapter: _old, ...rest } = s;
  return chapter ? { ...rest, chapter } : rest;
};

const blankQuestion = (): Question => ({ prompt: "", options: ["", ""], answer: 0, why: "" });

function Questions<Q extends Question>({ items, segments, onChange, review = false, test }: { items: readonly Q[]; segments: number; onChange: (qs: (Q | Checkpoint | Question)[]) => void; review?: boolean; test: string }) {
  const set = (i: number, q: Q | Question | Checkpoint) => onChange(items.map((x, j) => (j === i ? q : x)));
  return (
    <ol className="studio-list">
      {items.map((q, i) => (
        <li key={i} className="studio-question" data-test={`${test}-${i}`}>
          <TextField label={`Question ${i + 1}`} value={q.prompt} onChange={(prompt) => set(i, { ...q, prompt })} long />
          <fieldset className="field">
            <legend>Options · choose the right one</legend>
            {q.options.map((o, k) => (
              <span key={k} className="studio-row">
                <input type="radio" name={`${test}-${i}-answer`} checked={q.answer === k} onChange={() => set(i, { ...q, answer: k })} aria-label={`Option ${LETTERS[k]} is right`} data-test={`${test}-${i}-right-${k}`} />
                <input className="input" value={o} placeholder={`Option ${LETTERS[k]}`} onChange={(e) => set(i, { ...q, options: q.options.map((x, m) => (m === k ? e.target.value : x)) })} aria-label={`Option ${LETTERS[k]}`} data-test={`${test}-${i}-option-${k}`} />
                {q.options.length > 2 && (
                  <Button className="ghost-icon ghost-icon--sm" onClick={() => set(i, { ...q, options: q.options.filter((_, m) => m !== k), answer: q.answer === k ? 0 : q.answer > k ? q.answer - 1 : q.answer })} aria-label={`Remove option ${LETTERS[k]}`}>
                    <Close width={16} height={16} />
                  </Button>
                )}
              </span>
            ))}
            {q.options.length < 4 && (
              <Button className="textbtn" onClick={() => set(i, { ...q, options: [...q.options, ""] })}>
                <Plus width={16} height={16} /> Add an option
              </Button>
            )}
          </fieldset>
          <TextField label="Why (shown once answered)" value={q.why} onChange={(why) => set(i, { ...q, why })} long />
          {review && "afterSegment" in q && typeof q.afterSegment === "number" && (
            <Choice label="Pause after segment" value={q.afterSegment} options={Array.from({ length: Math.max(1, segments) }, (_, k) => k)} onChange={(afterSegment) => set(i, { ...q, afterSegment })} show={(k) => `Segment ${k + 1}`} />
          )}
          <RowTools i={i} n={items.length} label={`question ${i + 1}`} onMove={(d) => onChange(move(items, i, d))} onRemove={() => onChange(items.filter((_, j) => j !== i))} />
        </li>
      ))}
      <li>
        <Button className="textbtn" onClick={() => onChange([...items, review ? { ...blankQuestion(), afterSegment: Math.max(0, segments - 1) } : blankQuestion()])} data-test={`add-${test}`}>
          <Plus width={16} height={16} /> Add a question
        </Button>
      </li>
    </ol>
  );
}
