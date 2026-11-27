import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, type FormEvent } from 'react';
import { confidence, FEE_FIGURES, feeChoices, feeFigures, feeState, GROUP_MIN, PUBLISH_MIN, standardClient, type ChoiceKey } from '../../../src/data/fees.ts';
import { capitalised, formatDay, numberWord } from '../../../src/lib/format.ts';
import type { Edition, Spread } from '../../../src/server/fees.ts';
import { Page } from '../components/club/Page.tsx';
import { PageHead } from '../components/club/PageHead.tsx';
import { FieldError } from '../components/FieldError.tsx';
import { Section } from '../components/public/Section.tsx';
import { useAction } from '../components/useAction.ts';
import { answerFeeSurvey, feesPage } from '../functions/public-fees.ts';
import { linkTextParam } from '../lib/search-params.ts';
import { clubTitle } from '../lib/title.ts';
import s from './fees.module.css';
import { hostFirstName } from '../../../src/data/authors.ts';

export const Route = createFileRoute('/fees')({
  validateSearch: (search: Record<string, unknown>): { edition?: number; answered?: true } => {
    const edition = search['edition'] === undefined ? Number.NaN : Number(linkTextParam(search['edition']));
    return { ...(Number.isInteger(edition) && { edition }), ...('answered' in search && { answered: true }) };
  },
  loaderDeps: ({ search }) => ({ edition: search.edition }),
  loader: ({ deps }) => feesPage({ data: { edition: deps.edition } }),
  head: () => ({
    meta: [
      ...clubTitle('Fee survey'),
      { name: 'description', content: 'What accountants in Malaysia charge: an anonymous yearly survey of hourly rates, bookkeeping fees and tax return fees, with the results free to read.' },
    ],
  }),
  component: Fees,
});

const rm = (n: number) => `RM ${Math.round(n).toLocaleString('en-MY')}`;
const middleHalf = (spread: Spread) => `${rm(spread.p25)}–${Math.round(spread.p75).toLocaleString('en-MY')}`;
const place = (spread: Spread, scale: number) => {
  const at = (n: number) => `${((n / scale) * 100).toFixed(2)}%`;
  return { '--lo': at(spread.p25), '--mid': at(spread.median), '--hi': at(spread.p75) };
};

const soFar = (e: Edition) =>
  e.responses === 0
    ? `Nobody has answered the ${e.edition} survey yet.`
    : `${capitalised(e.responses === 1 ? 'one person has' : `${numberWord(e.responses)} people have`)} answered the ${e.edition} survey so far.`;
const until = (e: Edition) => (e.responses >= PUBLISH_MIN ? `once ${hostFirstName} has read every answer` : `once ${PUBLISH_MIN} have answered and ${hostFirstName} has read every answer`);
const practice: readonly ChoiceKey[] = ['stage', 'years', 'team', 'niche', 'pricing'];

function Fees() {
  const { current, report, otherYears } = Route.useLoaderData();
  const thanked = Route.useSearch().answered === true;
  const open = current.status !== 'published';
  const resultsIntro = !report
    ? 'Not out yet.'
    : report.publishedAt
      ? `From ${report.responses} answers, published ${formatDay(report.publishedAt)}.`
      : `A preview of ${report.responses} answers. Not published, so only hosts can see it.`;

  return (
    <Page>
      <PageHead
        label="Fee survey"
        title="What do accountants in Malaysia charge?"
        lead="Few accountants know what anyone else charges, so most set their fees blind. Once a year the club asks practitioners what they charge, anonymously, and publishes what it learns for anyone to read."
      >
        {open && !thanked && (
          <a className="btn" href="#answer">
            Answer the {current.edition} survey
          </a>
        )}
      </PageHead>

      <Section id="results" no={1} title={report ? `The ${report.edition} results` : 'The results'} intro={resultsIntro}>
        {report ? (
          <div className={s.report}>
            {report.figures.map((f) => {
              const copy = feeFigures[f.figure];
              return (
                <section key={f.figure} className={s.figure} aria-labelledby={`figure-${f.figure}`}>
                  <h3 className="label" id={`figure-${f.figure}`}>
                    {copy.label}
                  </h3>
                  {f.everyone === null ? (
                    <p className={s.none}>Fewer than {GROUP_MIN} people gave this fee, so it is not shown.</p>
                  ) : (
                    <>
                      <p className={s.headline}>
                        <span className={`${s.big} serif`}>{rm(f.everyone.median)}</span>
                        <span>
                          {copy.per}, the median of {f.everyone.n} answers.
                        </span>
                      </p>
                      <div className={s.scroll}>
                        <table className={`ledger ${s.spreads}`}>
                          <caption className={s.sr}>
                            {copy.label} by group. {f.everyone.n} answered.
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Group</th>
                              <th scope="col">Answers</th>
                              <th scope="col">Median</th>
                              <th scope="col" className={s.half}>
                                Middle half
                                <span className={s.axis} aria-hidden="true">
                                  <span>RM 0</span>
                                  <span>{rm(f.scale)}</span>
                                </span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className={s.everyone}>
                              <th scope="row">Everyone</th>
                              <td>{f.everyone.n}</td>
                              <td>{rm(f.everyone.median)}</td>
                              <td className={s.half}>
                                {middleHalf(f.everyone)}
                                <span className={s.bar} style={place(f.everyone, f.scale)} aria-hidden="true" />
                              </td>
                            </tr>
                          </tbody>
                          {f.cuts.map((cut) => (
                            <tbody key={cut.title}>
                              <tr className={s.cut}>
                                <th scope="colgroup" colSpan={4}>
                                  {cut.title}
                                </th>
                              </tr>
                              {cut.groups.map((g) =>
                                g.spread ? (
                                  <tr key={g.label}>
                                    <th scope="row">{g.label}</th>
                                    <td>{g.spread.n}</td>
                                    <td>{rm(g.spread.median)}</td>
                                    <td className={s.half}>
                                      {middleHalf(g.spread)}
                                      <span className={s.bar} style={place(g.spread, f.scale)} aria-hidden="true" />
                                    </td>
                                  </tr>
                                ) : (
                                  <tr key={g.label} className={s.few}>
                                    <th scope="row">{g.label}</th>
                                    <td colSpan={3}>Fewer than {GROUP_MIN} answers</td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          ))}
                        </table>
                      </div>
                    </>
                  )}
                </section>
              );
            })}
            <dl className="facts">
              <div>
                <dt>The client</dt>
                <dd>{standardClient} Every fee is for this one client, so answers compare like with like.</dd>
              </div>
              <div>
                <dt>Median</dt>
                <dd>The middle answer. Half charge more, half charge less.</dd>
              </div>
              <div>
                <dt>Middle half</dt>
                <dd>From the 25th to the 75th percentile, where half of all answers fall. Each line draws it on one scale from RM 0, with a tick at the median.</dd>
              </div>
              <div>
                <dt>Small groups</dt>
                <dd>A group of fewer than {GROUP_MIN} is not shown, so no one answer can be picked out.</dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>{hostFirstName} reads every answer before the results go up and deletes any that are plainly made up.</dd>
              </div>
            </dl>
            {otherYears.length > 0 && (
              <nav className={`${s.years} small`} aria-label="Other years">
                <span>Other years</span>
                {otherYears.map((year) => (
                  <a key={year} href={`/fees?edition=${year}#results`}>
                    {year}
                  </a>
                ))}
              </nav>
            )}
          </div>
        ) : (
          <div className={s.waiting}>
            <p className={s.count}>
              <span className={`${s.big} serif`}>{current.responses}</span>
              <span>{current.responses === 1 ? 'answer' : 'answers'} so far</span>
            </p>
            <span className={s.progress} style={{ '--done': `${Math.min(100, (current.responses / PUBLISH_MIN) * 100).toFixed(2)}%` }} aria-hidden="true" />
            <p>
              {soFar(current)} The results go up here {until(current)}.
            </p>
            <p>
              Anyone can fill in a form like this, so a person checks the answers before the club puts its name to them. A group of fewer than {GROUP_MIN} is never shown, so no one answer can be picked out.
            </p>
          </div>
        )}
      </Section>

      <Section
        id="answer"
        no={2}
        title={thanked ? `The ${current.edition} survey` : open ? `Answer the ${current.edition} survey` : `The ${current.edition} survey has closed`}
        intro="Two minutes. The form asks for no name or email, and the club keeps nothing that says who you are."
      >
        {thanked ? (
          <div className={s.thanks} role="status">
            <p className="head serif">Thank you. Your answers are in.</p>
            <p>
              The {current.edition} results will appear on this page, under <a href="#results">the results</a>, {until(current)}. {soFar(current)}
            </p>
            <p className="small">Know someone who sets fees? Send them this page. The more who answer, the more groups have enough answers to show.</p>
          </div>
        ) : !open ? (
          <p className={s.closed}>
            The {current.edition} survey closed when its results went up. The {current.edition + 1} survey opens on 1 January.
          </p>
        ) : (
          <Survey current={current} showSoFar={report !== null && report.edition !== current.edition} />
        )}
      </Section>
    </Page>
  );
}

function Survey({ current, showSoFar }: { current: Edition; showSoFar: boolean }) {
  const send = useAction(answerFeeSurvey, { refresh: 'never' });
  const navigate = useNavigate();
  const router = useRouter();
  const { refusal } = send;
  const form = useRef<HTMLFormElement>(null);
  const state = send.field('state');
  const feesError = send.field('fees');
  const confidenceField = send.field('confidence', { hint: 'confidence-hint' });

  useEffect(() => {
    if (!refusal) return;
    const first = form.current?.querySelector<HTMLElement>(`.${s.error}`);
    /* The fees' shared error sits above the three fee fields, so it takes the first of them. */
    const control = first?.closest('fieldset, .field')?.querySelector<HTMLElement>('input, select') ?? (refusal.fields['fees'] ? form.current?.querySelector<HTMLElement>('#hourly') : null);
    (control ?? first)?.scrollIntoView({ block: 'center' });
    control?.focus({ preventScroll: true });
  }, [refusal]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields: Record<string, string> = {};
    for (const [name, value] of new FormData(event.currentTarget)) if (typeof value === 'string') fields[name] = value;
    const outcome = await send.run(fields);
    if (!outcome?.ok) return;
    await navigate({ to: '/fees', search: { answered: true }, hash: 'answer' });
    /* The count in the thanks includes this answer. */
    await router.invalidate();
  };

  return (
    <form ref={form} method="POST" className={s.survey} onSubmit={submit}>
      {showSoFar && <p className="small">{soFar(current)}</p>}
      {send.failure && (
        <p className={`error ${s.error}`} role="alert">
          {send.failure}
        </p>
      )}

      <div className={s.part}>
        <h3 className="label">Your practice</h3>
        {practice.map((key) => {
          const answer = send.field(key);
          return (
            <fieldset key={key} className={s.choice} aria-describedby={answer.input['aria-describedby']}>
              <legend>{feeChoices[key].label}</legend>
              <div className={s.options}>
                {feeChoices[key].options.map((o) => (
                  <label key={o.slug} className={s.option}>
                    <input type="radio" name={key} value={o.slug} required />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
              <FieldError field={answer} className={s.error} />
            </fieldset>
          );
        })}
        <div className="field">
          <label htmlFor="state">{feeState.label}</label>
          <select className="input" id="state" name="state" required defaultValue="" {...state.input}>
            <option value="" disabled>
              Choose a state
            </option>
            {feeState.options.map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
          <FieldError field={state} className={s.error} />
        </div>
      </div>

      <div className={s.part}>
        <h3 className="label">Your fees</h3>
        <div className={s.client}>
          <p className="label">The client</p>
          <p>{standardClient}</p>
          <p className="small">Answer each fee for this client, so every answer is about the same work. Leave out any you do not charge, but give at least one.</p>
          {feesError.error && (
            <p className={`error ${s.error}`} role="alert">
              {feesError.error}
            </p>
          )}
        </div>
        {FEE_FIGURES.map((figure) => {
          const copy = feeFigures[figure];
          const fee = send.field(figure, { hint: `${figure}-hint` });
          return (
            <div key={figure} className="field">
              <label htmlFor={figure}>{copy.question}</label>
              <div className="unit" data-unit="RM">
                <input
                  className="input"
                  id={figure}
                  name={figure}
                  type="number"
                  inputMode="numeric"
                  min={copy.min}
                  max={copy.max}
                  step="1"
                  aria-describedby={fee.input['aria-describedby']}
                  aria-invalid={fee.input['aria-invalid']}
                />
              </div>
              <span className="hint" id={`${figure}-hint`}>
                {copy.hint}
              </span>
              <FieldError field={fee} className={s.error} />
            </div>
          );
        })}
        <fieldset className={s.choice} aria-describedby={confidenceField.input['aria-describedby']}>
          <legend>{confidence.label}</legend>
          <span className="hint" id="confidence-hint">
            {confidence.hint}
          </span>
          <div className={s.scale}>
            {confidence.scale.map((n) => (
              <label key={n} className={s.point}>
                <input type="radio" name="confidence" value={n} required />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <FieldError field={confidenceField} className={s.error} />
        </fieldset>
      </div>

      <div className={s.trap} aria-hidden="true">
        <label htmlFor="fees-trap">Leave this empty</label>
        <input id="fees-trap" name="trap" type="text" tabIndex={-1} autoComplete="off" data-1p-ignore data-lpignore="true" />
      </div>
      <button className="btn" type="submit" disabled={send.busy}>
        Send my answers
      </button>
    </form>
  );
}
