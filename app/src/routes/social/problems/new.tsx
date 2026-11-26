import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { OPTION_KEYS, POST_JURISDICTIONS, PROBLEM_LIMITS, TOPICS } from '../../../../../src/data/social.ts';
import { formatMoment, tally } from '../../../../../src/lib/format.ts';
import { SocialLink, useGo } from '../../../components/social/SocialLink.tsx';
import { useAction } from '../../../components/social/useAction.ts';
import { newProblemPage, removeProblem, writeProblem } from '../../../functions/social-problems.ts';
import { socialSignInHref } from '../../../lib/links.ts';
import { noindex, socialTitle } from '../../../lib/title.ts';

const STATE_LABEL = { scheduled: 'Scheduled', open: 'Open now', closed: 'Closed' } as const;

export const Route = createFileRoute('/social/problems/new')({
  staticData: { section: 'problems' },
  beforeLoad: ({ context }) => {
    if (!context.member) throw redirect({ href: socialSignInHref('/problems/new') });
  },
  loader: () => newProblemPage(),
  head: ({ loaderData }) => ({ meta: [...socialTitle(loaderData ? 'Write a problem' : 'Not found'), noindex] }),
  notFoundComponent: () => (
    <div className="page">
      <div className="card empty">
        <h1 className="head">Not found.</h1>
        <SocialLink className="btn sm" path="/problems">
          Back to Problems
        </SocialLink>
      </div>
    </div>
  ),
  component: WriteProblem,
});

type Data = Awaited<ReturnType<typeof newProblemPage>>;

function WriteProblem() {
  const data = Route.useLoaderData();
  const write = useAction(writeProblem, { refresh: false });
  const go = useGo();
  const [removed, setRemoved] = useState(false);
  const [removeFailure, setRemoveFailure] = useState<string | null>(null);
  const writeFailure = write.failure;
  const failure = writeFailure ?? removeFailure;
  const invalid = (name: string) => (write.error(name) ? { 'aria-invalid': true, 'aria-describedby': `${name}-error` } : {});
  const described = (name: string) => (write.error(name) ? `${name}-error` : undefined);
  const error = (name: string) =>
    write.error(name) && (
      <span className="error" id={`${name}-error`}>
        {write.error(name)}
      </span>
    );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const one = (name: string) => String(form.get(name) ?? '');
    const all = (name: string) => form.getAll(name).map(String);
    setRemoved(false);
    setRemoveFailure(null);
    const outcome = await write.run({
      number: one('number'),
      tag: one('tag'),
      jurisdiction: one('jurisdiction'),
      title: one('title'),
      scenario: all('scenario'),
      ask: one('ask'),
      options: all('options'),
      opensDate: one('opensDate'),
      opensTime: one('opensTime'),
      closesDate: one('closesDate'),
      closesTime: one('closesTime'),
    });
    if (outcome.ok) go(`/problems/${outcome.value.number}?written=1`);
  };

  return (
    <div className="page narrow">
      <p className="note tip plain">
        <svg aria-hidden="true">
          <use href="#i-shield" />
        </svg>
        <span>Team view. Members see a problem once it opens.</span>
      </p>
      <div className="page-head">
        <div>
          <p className="kicker">Problems</p>
          <h1 className="title">Write a problem.</h1>
          <p className="lead">A short scenario and one judgment call. No client data. Only one problem is open at a time, and you can take one back until someone answers it.</p>
        </div>
      </div>
      {removed && (
        <p className="note" role="status">
          Taken back. It is gone.
        </p>
      )}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}

      {/* Keyed by its starting values, so the form starts over when fresher ones arrive after a cached visit. */}
      <form key={`${data.nextNumber} ${data.opens}`} className="panel card" method="POST" ref={write.form} onSubmit={submit} noValidate>
        <div className="row2">
          <div className="field">
            <label htmlFor="p-number">Number</label>
            <input className="input" id="p-number" name="number" inputMode="numeric" required defaultValue={String(data.nextNumber)} {...invalid('number')} />
            {error('number')}
          </div>
          <div className="field">
            <label htmlFor="p-tag">Topic</label>
            <select className="input" id="p-tag" name="tag" defaultValue={TOPICS[0]}>
              {TOPICS.map((topic) => (
                <option key={topic}>{topic}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-jurisdiction">Jurisdiction</label>
            <select className="input" id="p-jurisdiction" name="jurisdiction" defaultValue="MY">
              {POST_JURISDICTIONS.map((j) => (
                <option key={j}>{j}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-title">Title</label>
          <input className="input" id="p-title" name="title" required maxLength={PROBLEM_LIMITS.title} placeholder="The stock count nobody attended" {...invalid('title')} />
          {error('title')}
        </div>
        <fieldset className="field plain-fieldset" aria-describedby={described('scenario')}>
          <legend className="label-text">
            Scenario · {PROBLEM_LIMITS.scenario.min} to {PROBLEM_LIMITS.scenario.max} lines
          </legend>
          {Array.from({ length: PROBLEM_LIMITS.scenario.max }, (_, i) => (
            <input
              key={i}
              className="input"
              name="scenario"
              maxLength={PROBLEM_LIMITS.line}
              aria-label={`Scenario line ${i + 1}${i < PROBLEM_LIMITS.scenario.min ? '' : ', optional'}`}
              aria-invalid={i === 0 && write.error('scenario') ? true : undefined}
            />
          ))}
          {error('scenario')}
        </fieldset>
        <div className="field">
          <label htmlFor="p-ask">The question</label>
          <input className="input" id="p-ask" name="ask" required maxLength={PROBLEM_LIMITS.ask} placeholder="What do you do before signing?" {...invalid('ask')} />
          {error('ask')}
        </div>
        <fieldset className="field plain-fieldset" aria-describedby={described('options')}>
          <legend className="label-text">
            Options · {PROBLEM_LIMITS.options.min} to {PROBLEM_LIMITS.options.max}, lettered in order
          </legend>
          {OPTION_KEYS.map((key, i) => (
            <div key={key} className="prefix" data-prefix={key}>
              <input
                className="input"
                name="options"
                maxLength={PROBLEM_LIMITS.option}
                aria-label={`Option ${key}${i < PROBLEM_LIMITS.options.min ? '' : ', optional'}`}
                aria-invalid={i === 0 && write.error('options') ? true : undefined}
              />
            </div>
          ))}
          {error('options')}
        </fieldset>
        <div className="row2">
          <div className="field">
            <label htmlFor="p-opens-date">Opens · date</label>
            <input className="input" id="p-opens-date" name="opensDate" type="date" required defaultValue={data.opens.slice(0, 10)} {...invalid('opensDate')} />
            {error('opensDate')}
          </div>
          <div className="field">
            <label htmlFor="p-opens-time">Opens · time</label>
            <input className="input" id="p-opens-time" name="opensTime" type="time" required defaultValue={data.opens.slice(11, 16)} {...invalid('opensTime')} />
            {error('opensTime')}
          </div>
          <div className="field">
            <label htmlFor="p-closes-date">Closes · date</label>
            <input className="input" id="p-closes-date" name="closesDate" type="date" required defaultValue={data.closes.slice(0, 10)} {...invalid('closesDate')} />
            {error('closesDate')}
          </div>
          <div className="field">
            <label htmlFor="p-closes-time">Closes · time</label>
            <input className="input" id="p-closes-time" name="closesTime" type="time" required defaultValue={data.closes.slice(11, 16)} {...invalid('closesTime')} />
            {error('closesTime')}
          </div>
        </div>
        <div className="panel-foot">
          <span className="small">Times are Malaysian. Members see it once it opens.</span>
          <button className="btn" type="submit" disabled={write.busy}>
            Save problem
          </button>
        </div>
      </form>

      <section className="section" aria-labelledby="schedule-title">
        <header>
          <h2 className="head" id="schedule-title">
            All problems
          </h2>
        </header>
        <ul className="queue">
          {data.schedule.length === 0 && (
            <li className="empty card">
              <p>None yet. The first one you save opens when you say.</p>
            </li>
          )}
          {data.schedule.map((problem) => (
            <li key={problem.number} className="queue-item card">
              <div>
                <p>
                  <b>
                    <SocialLink path={`/problems/${problem.number}`}>
                      #{problem.number} {problem.title}
                    </SocialLink>
                  </b>
                </p>
                <p className="small">
                  {STATE_LABEL[problem.state]} · {formatMoment(problem.opensAt)} to {formatMoment(problem.closesAt)} · {tally(problem.answers, 'answer')}
                </p>
              </div>
              {problem.answers === 0 && (
                <TakeBack
                  problem={problem}
                  onDone={() => {
                    setRemoveFailure(null);
                    setRemoved(true);
                  }}
                  onRefused={(message) => {
                    setRemoved(false);
                    setRemoveFailure(message);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TakeBack({ problem, onDone, onRefused }: { problem: Data['schedule'][number]; onDone: () => void; onRefused: (message: string) => void }) {
  const remove = useAction(removeProblem);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await remove.run({ number: problem.number });
    if (outcome.ok) onDone();
    else onRefused(outcome.message);
  };
  return (
    <details className="remove">
      <summary className="act">
        Take back<span className="sr-only"> problem {problem.number}</span>
      </summary>
      <form method="POST" onSubmit={submit}>
        <p className="small">Take back #{problem.number}? It is deleted. Write it again to fix it.</p>
        <button className="btn sm danger" type="submit" disabled={remove.busy}>
          Take it back
        </button>
      </form>
    </details>
  );
}
