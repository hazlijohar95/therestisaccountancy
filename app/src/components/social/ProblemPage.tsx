import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PROBLEM_LIMITS, RATINGS } from '../../../../src/data/social.ts';
import { formatMoment, tally } from '../../../../src/lib/format.ts';
import type { RatingCounts } from '../../../../src/server/social-problems.ts';
import { answerProblem, problemBoard, problemView, rateAnswer } from '../../functions/social-problems.ts';
import { socialSignInHref } from '../../lib/links.ts';
import { Avatar } from './Avatar.tsx';
import { Flair } from './Flair.tsx';
import { PostText } from './PostText.tsx';
import { SocialLink } from './SocialLink.tsx';
import { Tick } from './Tick.tsx';
import { useAction } from './useAction.ts';

export type Board = Awaited<ReturnType<typeof problemBoard>>;
export type View = NonNullable<Awaited<ReturnType<typeof problemView>>>;

const ratedLine = (ratings: RatingCounts) => {
  const total = ratings.sound + ratings.partly + ratings.unsound;
  return total ? `Rated by members with the seal: ${ratings.sound} sound, ${ratings.partly} partly, ${ratings.unsound} unsound.` : 'Not rated.';
};

/**
 * A problem with the archive beside it: /problems for the open one, /problems/12 for any number. With no view, the
 * empty state; with a number but no view, the 404.
 */
export function ProblemPage({ board, view, here, written = false }: { board: Board; view: View | null; here: string; written?: boolean }) {
  const numbered = here !== '/problems';
  const problem = view?.problem ?? null;
  const open = problem?.state === 'open';
  const closed = problem?.state === 'closed';
  const streakNote = board.streak
    ? open && !view?.mine
      ? 'Answer this week’s problem to keep it going.'
      : 'Answer the next problem to keep it going.'
    : open && !view?.mine
      ? 'Answer this week’s problem to start one.'
      : 'Answer the next problem to start one.';

  return (
    <div className="page problems">
      <div>
        {view ? (
          <Problem view={view} board={board} here={here} written={written} />
        ) : numbered ? (
          <div className="card empty">
            <h1 className="head">No problem with that number.</h1>
            <SocialLink className="btn sm" path="/problems">
              This week’s problem
            </SocialLink>
          </div>
        ) : (
          <>
            <div className="page-head">
              <div>
                <p className="kicker">Problems</p>
                <h1 className="title">One problem a week.</h1>
                <p className="lead">A short case with a judgment call. Answers stay hidden until you answer, and members with the seal rate the reasoning.</p>
              </div>
            </div>
            <div className="card empty">
              {board.next ? (
                <p className="head">
                  The next problem opens <time dateTime={board.next}>{formatMoment(board.next)}</time>.
                </p>
              ) : board.past.length ? (
                <p className="head">No problem is open this week.</p>
              ) : (
                <p className="head">The first problem opens soon.</p>
              )}
              {board.team ? (
                <SocialLink className="btn sm" path="/problems/new">
                  {board.past.length || board.next ? 'Write a problem' : 'Write the first problem'}
                </SocialLink>
              ) : board.past.length ? (
                <p>Read how members answered the last ones.</p>
              ) : board.signedIn ? (
                <>
                  <p>Claim your handle now and you can answer it the week it opens.</p>
                  <SocialLink className="btn sm" path="/me">
                    Go to your profile
                  </SocialLink>
                </>
              ) : (
                <>
                  <p>Join and you can answer it the week it opens. Social is free and invite-only.</p>
                  <SocialLink className="btn sm" path="/request">
                    Request to join
                  </SocialLink>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <aside className="side" aria-label="About problems">
        {board.streak !== null && (
          <div className="card streak">
            <p className="kicker">Your streak</p>
            <p className="streak-num">{board.streak ? tally(board.streak, 'week') : 'No streak yet'}</p>
            <p className="small">{streakNote}</p>
          </div>
        )}
        <div className="card how">
          <p className="kicker">How it works</p>
          <ol>
            <li>One scenario a week. No client data, ever.</li>
            <li>Pick an answer and explain it.</li>
            <li>See everyone else’s once you lock in.</li>
            <li>Members with the seal rate the reasoning. It builds your judgment record.</li>
          </ol>
        </div>
        {board.past.length > 0 && (
          <div>
            <p className="kicker side-label" id="past-title">
              Past problems
            </p>
            <ul className="past card" aria-labelledby="past-title">
              {board.past.map((entry) => (
                <li key={entry.number}>
                  <SocialLink path={`/problems/${entry.number}`} aria-current={entry.number === problem?.number ? 'page' : undefined}>
                    <span className="num">#{entry.number}</span>
                    <span>
                      <b>{entry.title}</b>
                      <br />
                      <span className="pixel">{entry.tag}</span>
                    </span>
                    <span className="num">
                      {entry.answers}
                      <span className="sr-only"> answers</span>
                    </span>
                  </SocialLink>
                </li>
              ))}
            </ul>
            {closed && (
              <SocialLink className="small back-week" path="/problems">
                This week’s problem
              </SocialLink>
            )}
          </div>
        )}
        {board.team && (
          <SocialLink className="btn sm ghost" path="/problems/new">
            Write a problem
          </SocialLink>
        )}
      </aside>
    </div>
  );
}

function Problem({ view, board, here, written }: { view: View; board: Board; here: string; written: boolean }) {
  const { problem } = view;
  const open = problem.state === 'open';
  const closed = problem.state === 'closed';
  const answer = useAction(answerProblem);
  const rate = useAction(rateAnswer);
  const [answered, setAnswered] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const answersRef = useRef<HTMLElement>(null);
  const optionText = (key: string) => problem.options.find((option) => option.key === key)?.text ?? key;
  const failure = [answer.refusal, rate.refusal].map((refusal) => (refusal && !Object.keys(refusal.fields).length ? refusal.message : null)).find(Boolean) ?? null;

  /* Answering lands on the answers, now open to read, as the page did after its redirect. */
  useEffect(() => {
    if (answered) answersRef.current?.scrollIntoView();
  }, [answered]);

  const submitAnswer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outcome = await answer.run({ number: problem.number, pick: String(form.get('pick') ?? ''), reasoning: String(form.get('reasoning') ?? '') });
    if (outcome.ok) setAnswered(true);
  };

  /* The chip keeps focus while it saves, so it is never disabled; a second press waits for the first. */
  const rateOne = async (answerId: number, button: string, rating: string) => {
    if (rate.busy) return;
    const outcome = await rate.run({ answer: answerId, button, rating });
    if (outcome.ok) setStatus(outcome.value.rating ? `Rated ${outcome.value.rating}.` : 'Rating taken back.');
  };

  return (
    <>
      {written && board.team && (
        <p className="note" role="status">
          Saved. It opens {formatMoment(problem.opensAt)}, Malaysian time.
        </p>
      )}
      <p className="sr-only" role="status">
        {status}
      </p>
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <article className="problem card" aria-labelledby="problem-title">
        {open && <span className="tape">problem of the week</span>}
        <p className="no">
          #{problem.number} · {problem.tag} · {problem.jurisdiction} ·{' '}
          {open ? (
            <>
              closes <time dateTime={problem.closesAt}>{formatMoment(problem.closesAt)}</time>
            </>
          ) : closed ? (
            `closed · ${tally(problem.answers, 'answer')}`
          ) : (
            <>
              opens <time dateTime={problem.opensAt}>{formatMoment(problem.opensAt)}</time>
            </>
          )}
        </p>
        <h1 className="title" id="problem-title">
          {problem.title}
        </h1>
        <ol className="scenario">
          {problem.scenario.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
        <p className="ask">{problem.ask}</p>
        {view.revealed ? (
          <>
            <Results view={view} optionText={optionText} />
            {view.mine ? (
              <p className="note">
                <Tick source="register" state="ticked" />
                <span>
                  You picked {view.mine.pick}.{' '}
                  {view.spread.filter((s) => s.count === Math.max(...view.spread.map((x) => x.count))).length > 1
                    ? 'Members are split on this one. Read why below.'
                    : view.most === view.mine.pick
                      ? 'Most members picked it too.'
                      : `Most members picked ${view.most}. Read why below.`}
                </span>
              </p>
            ) : (
              view.most && (
                <p className="note plain">
                  <Tick source="self" state="self" />
                  <span>Closed. The answers are open to read. {view.most} was the most common pick.</span>
                </p>
              )
            )}
          </>
        ) : open && view.viewer.hasHandle ? (
          <form method="POST" ref={answer.form} onSubmit={submitAnswer} noValidate>
            <fieldset className="options" aria-describedby={answer.error('pick') ? 'pick-error' : undefined}>
              <legend className="sr-only">Your answer</legend>
              {problem.options.map((option) => (
                <label key={option.key} className="opt">
                  <input className="sr-only" type="radio" name="pick" value={option.key} required aria-invalid={answer.error('pick') ? true : undefined} />
                  <span className="k">{option.key}</span>
                  <span>{option.text}</span>
                </label>
              ))}
            </fieldset>
            {answer.error('pick') && (
              <span className="error" id="pick-error">
                {answer.error('pick')}
              </span>
            )}
            <div className="reason field">
              <label htmlFor="why">Your reasoning · optional</label>
              <textarea
                className="input"
                id="why"
                name="reasoning"
                rows={4}
                maxLength={PROBLEM_LIMITS.reasoning}
                placeholder="Two or three sentences. Your peers rate the reasoning, not the letter."
                aria-invalid={answer.error('reasoning') ? true : undefined}
                aria-describedby={answer.error('reasoning') ? 'why-error' : undefined}
              />
              {answer.error('reasoning') && (
                <span className="error" id="why-error">
                  {answer.error('reasoning')}
                </span>
              )}
            </div>
            <div className="lockline">
              <svg aria-hidden="true">
                <use href="#i-lock" />
              </svg>
              <span>Everyone’s answers stay hidden until you answer. You answer once.</span>
              <button className="btn" type="submit" disabled={answer.busy}>
                Lock in my answer
              </button>
            </div>
          </form>
        ) : (
          <>
            <ol className="options static">
              {problem.options.map((option) => (
                <li key={option.key} className="opt">
                  <span className="k">{option.key}</span>
                  <span>{option.text}</span>
                </li>
              ))}
            </ol>
            {open && (
              <p className="lockline">
                <svg aria-hidden="true">
                  <use href="#i-lock" />
                </svg>
                {board.signedIn ? (
                  <span>
                    <SocialLink path="/edit">Claim your handle</SocialLink> to answer. Answers stay hidden until you do.
                  </span>
                ) : (
                  <span>
                    <a href={socialSignInHref(here)}>Sign in</a> to answer. Answers stay hidden until you do. New here?{' '}
                    <SocialLink path="/request">Request to join</SocialLink>.
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </article>

      {view.revealed && (
        <section className="section" id="answers" ref={answersRef} aria-labelledby="answers-title">
          <header>
            <h2 className="head" id="answers-title">
              {closed ? 'Answers' : 'Answers so far'}
            </h2>
            <span className="small">{tally(view.answers.length, 'answer')}</span>
          </header>
          {answered && (
            <p className="note" role="status">
              Locked in. Here is how everyone answered.
            </p>
          )}
          {open && !view.viewer.sealed && (
            <p className="note plain">
              <Tick source="self" state="self" />
              <span>
                Members with the seal rate answers. <SocialLink path="/verify">Get ticked</SocialLink> to rate.
              </span>
            </p>
          )}
          <div className="answers">
            {view.answers.map((a) => (
              <article key={a.id} className="answer" id={`answer-${a.id}`} data-mine={a.mine ? '' : undefined} aria-label={a.mine ? 'Your answer' : `Answer from ${a.author.name}`}>
                <div className="by">
                  <SocialLink className="author" path={`/@${a.author.handle}`}>
                    <Avatar name={a.author.name} track={a.author.track} sealed={a.author.sealed} size="sm" />
                    <span className="name-line">
                      {a.author.name}
                      {a.author.sealed && (
                        <svg className="seal" role="img" aria-label="Ticked">
                          <use href="#seal" />
                        </svg>
                      )}
                    </span>
                  </SocialLink>
                  <Flair track={a.author.track} />
                  <span className="pick">
                    <span className="sr-only">Picked </span>
                    {a.pick}
                  </span>
                </div>
                {a.reasoning ? <PostText text={a.reasoning} /> : <p className="small">No reasoning given.</p>}
                {view.canRate && !a.mine ? (
                  <div className="rate" role="group" aria-label={`Rate the answer from ${a.author.name}`}>
                    <span className="kicker label" aria-hidden="true">
                      Rate
                    </span>
                    {RATINGS.map((rating) => {
                      const pressed = a.viewerRating === rating.id;
                      return (
                        <form key={rating.id} method="POST" onSubmit={(event) => event.preventDefault()}>
                          <button
                            className="chip"
                            type="submit"
                            id={`rate-${a.id}-${rating.id}`}
                            data-k={rating.id}
                            aria-pressed={pressed ? 'true' : 'false'}
                            onClick={() => rateOne(a.id, rating.id, pressed ? 'none' : rating.id)}
                          >
                            {rating.label} · {a.ratings[rating.id]}
                          </button>
                        </form>
                      );
                    })}
                  </div>
                ) : (
                  <p className="small rated-line">
                    <Tick source="vouch" state="ticked" />
                    <span>{a.mine && open ? `${ratedLine(a.ratings)} Ratings close with the problem.` : ratedLine(a.ratings)}</span>
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** How members answered. The spread grows in once, from nothing to where the server drew it; with reduced motion it is simply there. */
function Results({ view, optionText }: { view: View; optionText: (key: string) => string }) {
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const fills = list.current?.querySelectorAll<HTMLElement>('.fill') ?? [];
    const counts = list.current?.querySelectorAll<HTMLElement>('.pct') ?? [];
    if (!fills.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    for (const fill of fills) fill.classList.add('from-zero');
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        for (const fill of fills) fill.classList.remove('from-zero');
        const start = performance.now();
        const step = (time: number) => {
          const k = Math.min(1, (time - start) / 900);
          for (const count of counts) count.textContent = `${Math.round(Number(count.dataset['to']) * (1 - (1 - k) ** 3))}%`;
          if (k < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <ul className="options results" aria-label="How members answered" ref={list}>
      {view.spread.map((s) => (
        <li key={s.key} className={view.mine?.pick === s.key ? 'opt mine' : 'opt'}>
          <i className={`fill ${s.key === view.most ? 'ht-5' : 'hatch'}`} style={{ '--w': `${s.percent}%` }} aria-hidden="true" />
          <span className="k">{s.key}</span>
          <span>
            {optionText(s.key)}
            {view.mine?.pick === s.key && <span className="sr-only">. Your pick.</span>}
          </span>
          <b className="pct" data-to={s.percent} aria-hidden="true">
            {s.percent}%
          </b>
          <span className="sr-only">{s.percent} percent</span>
        </li>
      ))}
    </ul>
  );
}
