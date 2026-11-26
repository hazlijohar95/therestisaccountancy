import { useEffect, useState } from "react";
import { Cover } from "../components/Cover.tsx";
import { Arrow, Check } from "../components/Icons.tsx";
import { Logo } from "../components/Logo.tsx";
import { PlayButton } from "../components/PlayButton.tsx";
import { Ring } from "../components/Ring.tsx";
import { Waveform } from "../components/Waveform.tsx";
import { courseById, courses, formatHours, formatTime } from "../domain/courses.ts";
import type { Course } from "../domain/types.ts";
import { Link, Stretch } from "../router.tsx";

const flagship = courseById("five-threats")!;

export function Landing() {
  return (
    <div className="landing">
      <header className="lhead">
        <Link href="/" aria-label="CPE home">
          <Logo />
        </Link>
        <nav className="lhead__nav">
          <Link href="/home">Courses</Link>
          <Link href="/ledger">Ledger</Link>
          <Link className="pill pill--ink pill--sm" href="/home" data-test="open-app">
            Open the app
          </Link>
        </nav>
      </header>

      <section className="lhero">
        <div className="lhero__copy">
          <h1 className="poster">
            CPE you can <mark>listen to</mark>.
          </h1>
          <p className="lhero__lead">Listen, answer as you go, and the credit files itself.</p>
          <div className="row">
            <Link className="pill pill--cpe" href={`/course/${flagship.id}`} data-test="hero-start">
              Start listening <Arrow width={18} height={18} />
            </Link>
            <Link className="pill pill--ghost" href="/home">
              Browse courses
            </Link>
          </div>
        </div>
        <div className="lhero__panel">
          <HeroDemo course={flagship} />
        </div>
      </section>

      <section className="lsteps" aria-label="How it works">
        <article className="lstep">
          <div className="lstep__art">
            <Waveform course={courses[2]!} time={courses[2]!.duration * 0.78} ranges={[[0, courses[2]!.duration * 0.34], [courses[2]!.duration * 0.52, courses[2]!.duration * 0.78]]} answered={[0]} />
          </div>
          <h2>Only what you hear counts.</h2>
        </article>
        <article className="lstep">
          <div className="lstep__art lstep__art--q">
            <span className="tape">Question 2</span>
            <span className="mini-opt">Self-review</span>
            <span className="mini-opt mini-opt--right">
              Intimidation <Check width={16} height={16} />
            </span>
            <span className="mini-opt">Advocacy</span>
          </div>
          <h2>Questions inside the episode.</h2>
        </article>
        <article className="lstep">
          <div className="lstep__art lstep__art--post">
            <span className="stamp">Passed</span>
            <span className="post-line">
              <span className="mono">DR</span> CPE ledger <span className="mono">1.0</span>
            </span>
          </div>
          <h2>Pass, and the hours post themselves.</h2>
        </article>
      </section>

      <section className="lshelf">
        <div className="lshelf__head">
          <h2 className="title">Start with a sample.</h2>
          <Link className="textbtn" href="/home">
            All courses <Arrow width={16} height={16} />
          </Link>
        </div>
        <div className="cards cards--four">
          {courses.map((c) => (
            <div key={c.id} className="card">
              <Stretch href={`/course/${c.id}`} label={c.title} />
              <span className="card__art">
                <Cover course={c} />
                <PlayButton course={c} size="md" />
              </span>
              <span className="card__title">{c.title}</span>
              <span className="card__meta">
                {c.field} · {formatTime(c.duration)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="lledger">
        <Ring
          slices={[
            { value: 4, tone: "var(--color-redline)" },
            { value: 9, tone: "var(--cpe)" },
            { value: 5, tone: "var(--color-ink)" },
            { value: 6, tone: "var(--color-tape)" },
          ]}
          total={40}
          size={260}
          stroke={26}
        >
          <span className="lledger__n">24</span>
          <span className="mono muted">of 40 h · example</span>
        </Ring>
        <div>
          <h2 className="title">Every hour, on one page.</h2>
          <p className="lead">Your cycle, your minimums, CPE from anywhere. Export when asked.</p>
          <Link className="pill pill--ink" href="/ledger">
            Open the ledger <Arrow width={18} height={18} />
          </Link>
        </div>
      </section>

      <footer className="lfoot">
        <Logo />
        <nav className="row">
          <Link href="/home">Courses</Link>
          <Link href="/ledger">Ledger</Link>
          <a href="https://therestisaccountancy.com">therestisaccountancy.com</a>
        </nav>
        <p className="sample">Prototype · sample courses use synthetic voices · credits are not accredited</p>
      </footer>
    </div>
  );
}

const RUN = 11_000;

/** Plays the credit path once, silently, from the real course's waveform and question positions, then rests on the result. */
function HeroDemo({ course }: { course: Course }) {
  const [t, setT] = useState(1);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / RUN);
      setT(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const listen = Math.min(1, t / 0.72);
  const time = listen * course.duration;
  const answered = course.checkpointTimes.flatMap((at, i) => (at <= time ? [i] : []));
  const posted = t > 0.88;

  return (
    <div className="demo" role="group" aria-label="How a course becomes credit">
      <div className="demo__head">
        <Cover course={course} size="sm" />
        <div>
          <p className="demo__title">{course.title}</p>
          <p className="demo__sub mono">
            {formatTime(time)} / {formatTime(course.duration)}
          </p>
        </div>
        <span className="demo__play" aria-hidden>
          <Ring slices={[{ value: listen, tone: "var(--cpe)" }]} total={1} size={44} stroke={4} />
        </span>
      </div>
      <Waveform course={course} time={time} ranges={[[0, time]]} answered={answered} />
      <div className="demo__chips">
        <span className={listen >= 1 ? "on" : ""}>Heard {Math.floor(listen * 100)}%</span>
        <span className={answered.length === course.checkpoints.length ? "on" : ""}>
          Review {answered.length}/{course.checkpoints.length}
        </span>
        <span className={t > 0.8 ? "on" : ""}>{t > 0.8 ? "Passed 5/5" : "Assessment"}</span>
      </div>
      <div className={`demo__post${posted ? " demo__post--on" : ""}`}>
        <Check width={18} height={18} /> {formatHours(course.credits)} CPE posted to your ledger
      </div>
    </div>
  );
}
