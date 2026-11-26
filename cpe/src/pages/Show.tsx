import { Cover, ShowCover } from "../components/Cover.tsx";
import { Check } from "../components/Icons.tsx";
import { PlayButton } from "../components/PlayButton.tsx";
import { statusLabel } from "../components/Shell.tsx";
import { formatHours, formatTime } from "../domain/courses.ts";
import { phaseOf } from "../domain/progress.ts";
import { Stretch } from "../router.tsx";
import { useAppState, useCatalogue } from "../state.tsx";
import { NotFound } from "./NotFound.tsx";

export function ShowPage({ id }: { id: string }) {
  const state = useAppState();
  const { courses, shows, loaded } = useCatalogue();
  const show = shows.find((s) => s.id === id);
  if (!show) return loaded ? <NotFound /> : null;
  const list = courses.filter((c) => c.show.id === show.id);
  const next = list.find((c) => phaseOf(state, c).kind !== "certified") ?? list[0]!;

  return (
    <div className="view">
      <header className="hero-head">
        <ShowCover motif={show.art} size="lg" />
        <div className="hero-head__text">
          <p className="eyebrow">Show</p>
          <h1 className="hero-head__title">{show.title}</h1>
          <p className="muted">{show.blurb}</p>
          <p className="hero-head__meta">
            {list.length} courses · {formatHours(list.reduce((n, c) => n + c.credits, 0))} CPE
          </p>
        </div>
      </header>
      <div className="actions">
        <PlayButton course={next} size="lg" />
      </div>
      <ol className="tracks">
        {list.map((c, i) => {
          const phase = phaseOf(state, c);
          return (
            <li key={c.id}>
              <div className="track">
                <Stretch href={`/course/${c.id}`} label={c.title} />
                <span className="track__n mono">{i + 1}</span>
                <Cover course={c} size="sm" />
                <span className="track__text">
                  <span className="track__title">{c.title}</span>
                  <span className="track__meta" data-field={c.field}>
                    <i className="dot" />
                    {c.field}
                  </span>
                </span>
                <span className={`track__status${phase.kind === "certified" ? " is-earned" : ""}`}>
                  {phase.kind === "certified" ? <Check width={16} height={16} /> : null}
                  {phase.kind === "new" ? `${formatHours(c.credits)} CPE` : statusLabel(phase)}
                </span>
                <span className="track__time mono">{formatTime(c.duration)}</span>
                <PlayButton course={c} size="sm" />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
