import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, type FormEvent } from 'react';
import { confidence, FEE_FIGURES, feeChoices, feeFigures, feeState, GROUP_MIN, PUBLISH_MIN, standardClient, type ChoiceKey } from '../../../src/data/fees.ts';
import { capitalised, formatDay, numberWord } from '../../../src/lib/format.ts';
import type { Edition, Spread } from '../../../src/server/fees.ts';
import { Page } from '../components/club/Page.tsx';
import { FieldError } from '../components/FieldError.tsx';
import { Empty } from '../components/ui/Empty.tsx';
import { Check, Field } from '../components/ui/Form.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { PageHead } from '../components/ui/PageHead.tsx';
import { Points } from '../components/ui/Points.tsx';
import { Section } from '../components/ui/Section.tsx';
import { Stat } from '../components/ui/Stat.tsx';
import { Progress } from '../components/ui/Steps.tsx';
import { Table } from '../components/ui/Table.tsx';
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
        lead="Once a year, practitioners tell the club what they charge, anonymously. The results are free for anyone to read."
        actions={
          open &&
          !thanked && (
            <a className="btn" href="#answer">
              Answer the {current.edition} survey
            </a>
          )
        }
      />

      <Section id="results" title={report ? `The ${report.edition} results` : 'The results'} meta={resultsIntro}>
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
                    <Empty icon="lock">Fewer than {GROUP_MIN} people gave this fee, so it is not shown.</Empty>
                  ) : (
                    <>
                      <Stat value={rm(f.everyone.median)} label={copy.per} note={`The median of ${f.everyone.n} answers`} />
                      <div className={s.spreads}>
                        <Table label={`${copy.label} by group`}>
                          <caption className="visually-hidden">
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
                        </Table>
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
                <dd>The middle answer. Half charge more, half less.</dd>
              </div>
              <div>
                <dt>Middle half</dt>
                <dd>The 25th to 75th percentile. Each line draws it from RM 0, with a tick at the median.</dd>
              </div>
              <div>
                <dt>Small groups</dt>
                <dd>Groups under {GROUP_MIN} are not shown, so no one answer can be picked out.</dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>{hostFirstName} reads every answer first and deletes any that are plainly made up.</dd>
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
          <>
            <Stat value={current.responses} label={current.responses === 1 ? 'answer so far' : 'answers so far'} />
            <Progress value={Math.min(current.responses, PUBLISH_MIN)} max={PUBLISH_MIN} label="Needed to publish" />
            <Points
              items={[
                { icon: 'calendar', text: `The results go up here ${until(current)}.` },
                { icon: 'check', text: 'A person checks every answer before the club puts its name to them.' },
                { icon: 'lock', text: `Groups under ${GROUP_MIN} are never shown, so no one answer can be picked out.` },
              ]}
            />
          </>
        )}
      </Section>

      <Section id="answer" title={thanked ? `The ${current.edition} survey` : open ? `Answer the ${current.edition} survey` : `The ${current.edition} survey has closed`}>
        {thanked ? (
          <>
            <Notice inline>Thank you. Your answers are in.</Notice>
            <Points
              items={[
                {
                  icon: 'calendar',
                  text: (
                    <>
                      The results appear under <a href="#results">the results</a> {until(current)}.
                    </>
                  ),
                },
                { icon: 'users', text: soFar(current) },
                { icon: 'mail', text: 'Know someone who sets fees? Send them this page. More answers, more groups shown.' },
              ]}
            />
          </>
        ) : !open ? (
          <Empty icon="calendar">
            The {current.edition} survey closed when its results went up. The {current.edition + 1} survey opens on 1 January.
          </Empty>
        ) : (
          <>
            <Points
              items={[
                { icon: 'clock', text: 'Two minutes' },
                { icon: 'lock', text: 'No name or email. Nothing kept says who you are.' },
              ]}
            />
            <Survey current={current} showSoFar={report !== null && report.edition !== current.edition} />
          </>
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
    /* Field errors carry .error; the shared fees error and a failure are alerts. Document order finds the first. */
    const first = form.current?.querySelector<HTMLElement>('.error, [role="alert"]');
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
        <Notice tone="error" inline>
          {send.failure}
        </Notice>
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
                  <Check key={o.slug} type="radio" name={key} value={o.slug} required label={o.label} />
                ))}
              </div>
              <FieldError field={answer} className={s.error} />
            </fieldset>
          );
        })}
        <Field label={feeState.label} id="state" field={state}>
          <select className="input" id="state" name="state" required defaultValue="" {...state.input}>
            <option value="" disabled>
              Choose a state
            </option>
            {feeState.options.map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className={s.part}>
        <h3 className="label">Your fees</h3>
        <div className={s.client}>
          <p className="label">The client</p>
          <p>{standardClient}</p>
          <p className="small">Answer each fee for this client. Leave out any you do not charge, but give at least one.</p>
          {feesError.error && (
            <Notice tone="error" inline>
              {feesError.error}
            </Notice>
          )}
        </div>
        {FEE_FIGURES.map((figure) => {
          const copy = feeFigures[figure];
          const fee = send.field(figure, { hint: `${figure}-hint` });
          return (
            <Field key={figure} label={copy.question} id={figure} hint={copy.hint} field={fee}>
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
            </Field>
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

      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="fees-trap">Leave this empty</label>
        <input id="fees-trap" name="trap" type="text" tabIndex={-1} autoComplete="off" data-1p-ignore data-lpignore="true" />
      </div>
      <button className="btn" type="submit" disabled={send.busy}>
        Send my answers
      </button>
    </form>
  );
}
