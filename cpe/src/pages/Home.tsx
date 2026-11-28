import { Progress } from "@base-ui/react/progress";
import { Cover, ShowCover } from "../components/Cover.tsx";
import { Check } from "../components/Icons.tsx";
import { PlayButton } from "../components/PlayButton.tsx";
import { Ring } from "../components/Ring.tsx";
import { statusLabel } from "../components/Shell.tsx";
import { fields, formatHours, formatTime } from "../domain/courses.ts";
import { mytDate, yearOf } from "../domain/calendar.ts";
import { hours, standingOf, structuredOf } from "../domain/ledger.ts";
import { coverage, phaseOf, progressOf } from "../domain/progress.ts";
import { Link, Stretch } from "../router.tsx";
import { useAppState, useCatalogue } from "../state.tsx";

function greeting(d: Date): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Home() {
  const state = useAppState();
  const { courses, shows } = useCatalogue();
  const year = yearOf(mytDate(new Date()));
  const structured = structuredOf(standingOf(state, year));
  const present = fields.filter((f) => courses.some((c) => c.field === f));

  return (
    <div className="view">
      <header className="hello">
        <h1 className="hello__title">{greeting(new Date())}{state.learner ? `, ${state.learner.split(" ")[0]}` : ""}</h1>
        <Link href="/ledger" className="hello__ring">
          <Ring slices={[{ value: structured ? Math.min(structured.have, structured.need) : 0, tone: "var(--cpe)" }]} total={structured?.need ?? 1} size={64} stroke={7}>
            {structured && <span className="tnum">{Math.min(100, Math.floor((structured.have / structured.need) * 100))}%</span>}
          </Ring>
          <span>
            <strong>{structured ? `${hours(structured.have)} of ${hours(structured.need)} h` : "No hours asked"}</strong>
            <span className="muted">{structured ? `structured, ${year}` : `by MIA in ${year}`}</span>
          </span>
        </Link>
      </header>

      <section className="tiles" aria-label="Courses">
        {courses.map((c) => {
          const phase = phaseOf(state, c);
          const heard = coverage(progressOf(state, c), c);
          return (
            <div key={c.id} className="tile">
              <Stretch href={`/course/${c.id}`} label={c.title} test={`tile-${c.id}`} />
              <Cover course={c} size="sm" />
              <span className="tile__text">
                <span className="tile__title">{c.title}</span>
                <span className={`tile__meta${phase.kind === "certified" ? " is-earned" : ""}`}>
                  {phase.kind === "certified" && <Check width={14} height={14} />}
                  {phase.kind === "new" ? `${formatHours(c.credits)} CPE · ${formatTime(c.duration)}` : statusLabel(phase)}
                </span>
              </span>
              {heard > 0 && phase.kind !== "certified" && (
                <Progress.Root value={Math.round(heard * 100)} aria-label={`${c.title} heard`} className="tile__progress">
                  <Progress.Track className="tile__bar">
                    <Progress.Indicator className="tile__fill" />
                  </Progress.Track>
                </Progress.Root>
              )}
              <PlayButton course={c} size="sm" />
            </div>
          );
        })}
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Shows</h2>
        <div className="cards">
          {shows.map((show) => {
            const list = courses.filter((c) => c.show.id === show.id);
            return (
              <Link key={show.id} href={`/show/${show.id}`} className="card">
                <ShowCover motif={show.art} />
                <span className="card__title">{show.title}</span>
                <span className="card__meta">
                  {list.length} courses · {formatHours(list.reduce((n, c) => n + c.credits, 0))} CPE
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Browse by field</h2>
        <div className="fields">
          {present.map((f) => (
            <Link key={f} href={`/search?field=${encodeURIComponent(f)}`} className="fieldtile" data-field={f}>
              <span>{f}</span>
              <span className="fieldtile__count">{courses.filter((c) => c.field === f).length}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
