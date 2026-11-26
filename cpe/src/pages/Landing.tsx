import { Accordion } from "@base-ui/react/accordion";
import { useState } from "react";
import { Arrow, Check, Ledger as LedgerIcon, Play, Plus } from "../components/Icons.tsx";
import { Logo } from "../components/Logo.tsx";
import { Ring } from "../components/Ring.tsx";
import { formatHours } from "../domain/courses.ts";
import { LISTEN_THRESHOLD } from "../domain/progress.ts";
import { HeroDemo } from "../landing/HeroDemo.tsx";
import { SamplePlayer } from "../landing/SamplePlayer.tsx";
import "../landing/landing.css";
import { Link } from "../router.tsx";
import { useCatalogue } from "../state.tsx";

/** The course the hero demo plays and the main buttons open. */
const FLAGSHIP = "five-threats";
const heardToCount = `${Math.round(LISTEN_THRESHOLD * 100)}%`;

const STEPS = [
  { icon: <Play width={18} height={18} />, title: "Listen", body: "Play an episode anywhere. Only what you actually hear counts towards credit." },
  { icon: <Check width={18} height={18} />, title: "Answer as you go", body: "Review questions pause the episode at the right moment, so you know it landed." },
  { icon: <LedgerIcon width={18} height={18} />, title: "Pass, and it posts", body: "Score 70% on a short assessment. The certificate is issued and the hours land in your ledger." },
];

const FACTS = [
  { n: heardToCount, label: "of the audio heard to count" },
  { n: "70%", label: "to pass the assessment" },
  { n: "5", label: `questions for a ${formatHours(1)}h course` },
  { n: "CSV", label: "export of your ledger" },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does pressing play count as credit?",
    a: `No. Only audio you actually hear counts, and you need ${heardToCount} of the episode. Skip ahead and the skipped part shows up on the waveform as unheard.`,
  },
  {
    q: "What are the questions inside the episode?",
    a: "Short review questions pause the episode at the point they cover. Answer them as you go. They don't count towards your score, but every one has to be answered before the assessment unlocks.",
  },
  {
    q: "How hard is the assessment?",
    a: "A half-hour course has 3 questions and a one-hour course has 5. You need 70% to pass, and you can try again if you don't.",
  },
  {
    q: "Where do my hours go?",
    a: "Into your ledger, with the certificate attached. Set your cycle and any minimums, such as ethics, and the ledger shows what's left. Export it as a CSV when someone asks.",
  },
  {
    q: "Is the credit accredited?",
    a: "Not yet. This is a preview with sample courses read by synthetic voices, and the hours are not accredited. Your progress is saved to your club account.",
  },
];

export function Landing() {
  const { courses, courseById } = useCatalogue();
  const flagship = courseById(FLAGSHIP);
  const [run, setRun] = useState(0);
  return (
    <div className="landing">
      <header className="l-nav">
        <div className="l-nav__inner">
          <Link href="/" aria-label="CPE home" className="l-nav__logo">
            <Logo />
          </Link>
          <nav className="l-nav__links" aria-label="Sections">
            <a href="#listen">Listen</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="l-nav__actions">
            <Link className="l-btn l-btn--white" href="/ledger">
              Ledger
            </Link>
            <Link className="l-btn l-btn--black" href="/home" data-test="open-app">
              Open the app
            </Link>
          </div>
        </div>
      </header>

      <main className="l-main">
        <section className="l-hero">
          <div className="l-split">
            <div>
              <h1 className="l-display">CPE you can listen to</h1>
              <div className="l-ctas">
                <Link className="l-btn l-btn--black l-btn--lg" href={`/course/${FLAGSHIP}`} data-test="hero-start">
                  Start listening
                </Link>
                <Link className="l-btn l-btn--white l-btn--lg" href="/home">
                  Browse courses
                </Link>
              </div>
            </div>
            <p className="l-intro">
              Short audio courses for accountants. Listen on the commute or between client calls, answer the questions as you go, and the hours post to your ledger
              when you pass.
            </p>
          </div>

          <div className="l-panel l-panel--stage">
            {flagship && <HeroDemo key={run} course={flagship} />}
          </div>
          <div className="l-replay">
            <button type="button" className="l-btn l-btn--white" onClick={() => setRun((n) => n + 1)}>
              Replay
            </button>
          </div>
        </section>

        <section className="l-section" id="listen">
          <div className="l-split l-split--head">
            <div>
              <p className="l-eyebrow">Try it now</p>
              <h2 className="l-h2">Listen to a sample course</h2>
            </div>
            <p className="l-intro">Every sample here is a real course. Press play and it counts, the same as in the app, so you can pick up where you left off.</p>
          </div>
          {courses.length > 0 && <SamplePlayer courses={courses} />}
        </section>

        <section className="l-section" id="how">
          <div className="l-split l-split--head">
            <div>
              <p className="l-eyebrow">How it works</p>
              <h2 className="l-h2">From earbuds to ledger in three steps</h2>
            </div>
            <p className="l-intro">No webinar to sit through and no form to fill in. The course keeps track of what you heard, and the ledger keeps track of the hours.</p>
          </div>
          <ol className="l-cards">
            {STEPS.map((s) => (
              <li key={s.title} className="l-card">
                <span className="l-card__icon">{s.icon}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
          <ul className="l-facts" aria-label="The rules">
            {FACTS.map((f) => (
              <li key={f.label}>
                <b>{f.n}</b>
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="l-section">
          <div className="l-split l-split--feature">
            <div>
              <p className="l-eyebrow">The ledger</p>
              <h2 className="l-h2">Every hour, on one page</h2>
              <p className="l-intro l-intro--left">
                Set your cycle and your ethics minimum once. Every course you pass lands here with its certificate, and the whole ledger exports as a CSV when you&apos;re
                asked for it.
              </p>
              <Link className="l-btn l-btn--black l-btn--lg" href="/ledger">
                Open the ledger
              </Link>
            </div>
            <div className="l-panel l-panel--ring">
              <div className="l-ringcard">
                <Ring
                  slices={[
                    { value: 4, tone: "var(--color-redline)" },
                    { value: 9, tone: "var(--color-ink)" },
                    { value: 5, tone: "var(--field-accounting)" },
                    { value: 6, tone: "var(--color-tape)" },
                  ]}
                  total={40}
                  size={200}
                  stroke={14}
                >
                  <span className="l-ringcard__n">24</span>
                  <span className="l-ringcard__of">of 40h</span>
                </Ring>
                <ul className="l-ringcard__legend">
                  <li>
                    <i style={{ background: "var(--color-redline)" }} /> Ethics <b>4.0h</b>
                  </li>
                  <li>
                    <i style={{ background: "var(--color-ink)" }} /> Auditing <b>9.0h</b>
                  </li>
                  <li>
                    <i style={{ background: "var(--field-accounting)" }} /> Accounting <b>5.0h</b>
                  </li>
                  <li>
                    <i style={{ background: "var(--color-tape)" }} /> Practice <b>6.0h</b>
                  </li>
                </ul>
                <span className="l-ringcard__note">Example cycle</span>
              </div>
            </div>
          </div>
        </section>

        <section className="l-section" id="faq">
          <div className="l-split">
            <div>
              <p className="l-eyebrow">Questions</p>
              <h2 className="l-h2">The fine print, upfront</h2>
            </div>
            <Accordion.Root className="l-acc">
              {FAQ.map((f) => (
                <Accordion.Item key={f.q} className="l-acc__item">
                  <Accordion.Header className="l-acc__head">
                    <Accordion.Trigger className="l-acc__trigger">
                      {f.q}
                      <Plus width={18} height={18} className="l-acc__icon" />
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Panel className="l-acc__panel">
                    <p>{f.a}</p>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion.Root>
          </div>
        </section>

        <section className="l-section l-final">
          <h2 className="l-display l-display--md">Your next hour is one episode away</h2>
          <div className="l-ctas l-ctas--center">
            <Link className="l-btn l-btn--black l-btn--lg" href={`/course/${FLAGSHIP}`}>
              Start listening <Arrow width={16} height={16} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="l-foot">
        <div className="l-foot__inner">
          <Logo />
          <nav className="l-foot__links" aria-label="Footer">
            <Link href="/home">Courses</Link>
            <Link href="/ledger">Ledger</Link>
            <a href="https://therestisaccountancy.com">therestisaccountancy.com</a>
          </nav>
          <p className="l-foot__fine">Preview · sample courses use synthetic voices · credits are not accredited</p>
        </div>
      </footer>
    </div>
  );
}
