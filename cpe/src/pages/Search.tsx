import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useState } from "react";
import { Cover } from "../components/Cover.tsx";
import { Search as SearchIcon } from "../components/Icons.tsx";
import { PlayButton } from "../components/PlayButton.tsx";
import { fields, formatHours, formatTime } from "../domain/courses.ts";
import type { Course, Field } from "../domain/types.ts";
import { setQuery, Stretch } from "../router.tsx";
import { useCatalogue } from "../state.tsx";

interface Hit {
  course: Course;
  /** Where in the episode the words were said, when the match came from the transcript. */
  line?: { text: string; start: number };
}

function find(courses: readonly Course[], q: string, field: Field | null): Hit[] {
  const needle = q.trim().toLowerCase();
  return courses.flatMap((course): Hit[] => {
    if (field && course.field !== field) return [];
    if (!needle) return [{ course }];
    if ([course.title, course.dek, course.field, course.show.title].some((t) => t.toLowerCase().includes(needle))) return [{ course }];
    const seg = course.segments.find((s) => s.text.toLowerCase().includes(needle));
    return seg ? [{ course, line: { text: seg.text, start: seg.start } }] : [];
  });
}

function Snippet({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  const from = Math.max(0, i - 40);
  const to = Math.min(text.length, i + q.length + 60);
  return (
    <span className="snippet">
      {from > 0 && "…"}
      {text.slice(from, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length, to)}
      {to < text.length && "…"}
    </span>
  );
}

export function Search() {
  const { courses } = useCatalogue();
  const params = new URLSearchParams(location.search);
  const initialField = fields.find((f) => f === params.get("field")) ?? null;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [field, setField] = useState<Field | null>(initialField);
  const present = fields.filter((f) => courses.some((c) => c.field === f));
  const browsing = !q.trim() && !field;
  const hits = browsing ? [] : find(courses, q, field);

  const update = (nq: string, nf: Field | null) => {
    setQ(nq);
    setField(nf);
    setQuery({ q: nq.trim(), field: nf ?? "" });
  };

  return (
    <div className="view">
      <label className="searchbox">
        <SearchIcon width={22} height={22} />
        <span className="sr-only">Search courses and transcripts</span>
        <Input
          type="search"
          value={q}
          autoFocus
          onValueChange={(v) => update(v, field)}
          placeholder="Courses, topics, transcripts"
          data-test="search-input"
        />
      </label>
      <ToggleGroup
        className="chips"
        aria-label="Field of study"
        value={field ? [field] : []}
        onValueChange={(vals) => update(q, fields.find((f) => f === vals[0]) ?? null)}
      >
        {present.map((f) => (
          <Toggle key={f} value={f} className="chip" data-test={`chip-${f}`}>
            {f}
          </Toggle>
        ))}
      </ToggleGroup>

      {browsing ? (
        <section className="shelf">
          <h2 className="shelf__title">Browse all</h2>
          <div className="fields fields--big">
            {present.map((f) => (
              <Button key={f} className="fieldtile" data-field={f} onClick={() => update("", f)}>
                <span>{f}</span>
                <span className="fieldtile__count">{courses.filter((c) => c.field === f).length}</span>
              </Button>
            ))}
          </div>
        </section>
      ) : hits.length === 0 ? (
        <div className="empty-line" role="status">
          <p>
            {q.trim() ? `No results for “${q.trim()}”${field ? ` in ${field}` : ""}.` : `No ${field} courses yet.`}
          </p>
          <Button className="textbtn" onClick={() => update("", null)} data-test="clear-search">
            Clear search
          </Button>
        </div>
      ) : (
        <section className="results" aria-label="Results">
          <p className="sr-only" role="status">
            {hits.length} {hits.length === 1 ? "result" : "results"}
          </p>
          <div className="top">
            <Stretch href={`/course/${hits[0]!.course.id}`} label={hits[0]!.course.title} />
            <p className="eyebrow">Top result</p>
            <Cover course={hits[0]!.course} size="sm" />
            <span className="top__title">{hits[0]!.course.title}</span>
            <span className="top__meta">
              {hits[0]!.course.show.title} · {formatHours(hits[0]!.course.credits)} CPE
            </span>
            <PlayButton course={hits[0]!.course} at={hits[0]!.line?.start} />
          </div>
          <ul className="rows">
            {hits.map(({ course, line }) => (
              <li key={course.id}>
                <div className="hit">
                  <Stretch href={`/course/${course.id}`} label={course.title} test={`result-${course.id}`} />
                  <Cover course={course} size="sm" />
                  <span className="hit__text">
                    <span className="hit__title">{course.title}</span>
                    {line ? <Snippet text={line.text} q={q.trim()} /> : <span className="hit__meta">{course.field}</span>}
                  </span>
                  <span className="hit__time tnum">{line ? `at ${formatTime(line.start)}` : formatTime(course.duration)}</span>
                  <PlayButton course={course} size="sm" at={line?.start} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
