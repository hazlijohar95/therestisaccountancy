import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { PLAN_ANSWER_MAX, planSections, type PlanSectionSlug } from '../../../../../src/data/plan.ts';
import { capitalised, formatDay, formatMoment, numberWord } from '../../../../../src/lib/format.ts';
import { Masthead } from '../../../components/club/Masthead.tsx';
import { Notice } from '../../../components/club/Notice.tsx';
import { PlanLetter } from '../../../components/club/PlanLetter.tsx';
import { FieldError } from '../../../components/FieldError.tsx';
import { useAction } from '../../../components/useAction.ts';
import { membersPlan, savePlan, sendPlan, startPlan, takeBackPlan } from '../../../functions/members-plans.ts';
import { wireField } from '../../../lib/form.ts';
import { flags } from '../../../components/members/flags.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './index.module.css';
import { hostFirstName } from '../../../../../src/data/authors.ts';

const FLAGS = ['saved', 'sent', 'unsent', 'back', 'started'] as const;
type Flag = (typeof FLAGS)[number];

export const Route = createFileRoute('/members/plan/')({
  validateSearch: flags(...FLAGS),
  loader: () => membersPlan(),
  head: () => ({ meta: clubTitle('Your plan') }),
  component: PlanPage,
});

function PlanPage() {
  const { open, answered } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const save = useAction(savePlan, { refresh: 'never' });
  const send = useAction(sendPlan, { refresh: 'never' });
  const back = useAction(takeBackPlan, { refresh: 'never' });
  const start = useAction(startPlan, { refresh: 'never' });
  /* The four actions share one notice slot, so only the last one's refusal is kept. */
  const refusal = save.refusal ?? send.refusal ?? back.refusal ?? start.refusal;
  /* A refused save or send keeps what was typed; text not saved because the plan is with the hosts is shown back. */
  const [posted, setPosted] = useState<Record<string, string> | null>(null);

  const latest = answered[0] ?? null;
  const draft = open?.status === 'draft' ? open : null;
  const tooLong = refusal !== null && posted !== null && Object.keys(refusal.fields).length > 0;
  const failure = refusal && !tooLong ? refusal.message : null;
  /* An earlier outcome is not repeated over a fresh error. */
  const settled = refusal === null;
  const writing = draft !== null || (open === null && (latest === null || posted !== null));
  const unsent = settled && draft !== null && search.unsent === true;
  /** What the last action did, said only while it is still true. */
  const outcomes = [
    { key: 'saved', holds: draft !== null, text: 'Draft saved.' },
    { key: 'sent', holds: open?.status === 'sent', text: `Sent to ${hostFirstName}. You will get the answer by email.` },
    { key: 'back', holds: draft !== null, text: `Taken back. It is a draft again, and off ${hostFirstName}’s list until you send it.` },
    { key: 'started', holds: draft !== null, text: 'Your next plan is open. It starts from your last one, with a blank question.' },
  ] as const;
  const notice = settled ? (outcomes.find((o) => o.holds && search[o.key])?.text ?? null) : null;

  const missing = new Set<PlanSectionSlug>(unsent && draft ? draft.missing : []);
  const answerOf = (slug: PlanSectionSlug) => (posted ? (posted[slug] ?? '') : (draft?.answers[slug] ?? ''));
  const errorOf = (slug: PlanSectionSlug) => (tooLong ? refusal.fields[slug] : undefined) ?? (missing.has(slug) ? 'Write this section before you send it.' : null);
  const unsaved = open?.status === 'sent' && posted ? planSections.filter((section) => (posted[section.slug] ?? '').trim() !== '') : [];
  const sections = numberWord(planSections.length);
  const written = planSections.length - (draft ? draft.missing.length : planSections.length);
  const progress = written === 0 ? 'No sections written yet.' : `${capitalised(numberWord(written))} of ${sections} sections written.`;
  const number = (i: number) => String(i + 1).padStart(2, '0');

  const clear = (except?: { clear: () => void }) => {
    for (const action of [save, send, back, start]) if (action !== except) action.clear();
  };
  /* Each action lands on a plain address, so a refresh never posts twice. */
  const land = async (flag: Flag) => {
    clear();
    setPosted(null);
    await navigate({ to: '/members/plan', search: { [flag]: true } });
    await router.invalidate();
  };
  const refuse = async (by: { clear: () => void }, typed: Record<string, string> | null) => {
    clear(by);
    setPosted(typed);
    await router.invalidate();
  };

  const write = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const typed = Object.fromEntries(planSections.map(({ slug }) => [slug, String(form.get(slug) ?? '')]));
    const sending = event.nativeEvent instanceof SubmitEvent && event.nativeEvent.submitter instanceof HTMLButtonElement && event.nativeEvent.submitter.value === 'send';
    if (sending) {
      const outcome = await send.run(typed);
      if (!outcome) return;
      return outcome.ok ? land(outcome.value.sent ? 'sent' : 'unsent') : refuse(send, typed);
    }
    const outcome = await save.run(typed);
    if (!outcome) return;
    return outcome.ok ? land('saved') : refuse(save, typed);
  };
  const act = (action: 'back' | 'start') => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const by = action === 'back' ? back : start;
    const outcome = await by.run(undefined);
    if (!outcome) return;
    return outcome.ok ? land(action === 'back' ? 'back' : 'started') : refuse(by, null);
  };

  return (
    <>
      <Masthead
        label={
          <span>
            <a href="/members/programmes/growth">Growth</a> / Your plan
          </span>
        }
        title="The firm you want, written down."
        narrow
      >
        <p>
          {capitalised(sections)} sections, in your own words. Save as you go, and send it to {hostFirstName} once every section is written. {hostFirstName} reads it and answers in writing. It is the last module of Growth, and the lessons before it lead up to it.
        </p>
      </Masthead>

      {notice && <Notice>{notice}</Notice>}
      {unsent && <Notice tone="error">Saved as a draft, not sent. Write the sections marked below, then send it.</Notice>}
      {tooLong && <Notice tone="error">Nothing was saved. A section is over the limit, and it is marked below.</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      {writing && (
        <section className={`wrap ${s.block}`} aria-labelledby="draft-title">
          <div className={s.state}>
            <h2 className="head" id="draft-title">
              {draft ? 'Your draft' : 'Start your plan'}
            </h2>
            <p className="small">{draft ? `${progress} Last saved ${formatMoment(draft.updatedAt)}.` : 'Nothing is kept until you save. Write as much or as little as you like to begin with.'}</p>
          </div>
          <form method="POST" onSubmit={write}>
            <ol className={s.sections}>
              {planSections.map((section, i) => {
                const hint = `${section.slug}-hint`;
                const error = wireField(errorOf(section.slug), { id: `${section.slug}-error`, hint });
                return (
                  <li key={section.slug} className={s.section}>
                    <label className={s.heading} htmlFor={section.slug}>
                      <span className={`serif ${s.n}`} aria-hidden="true">
                        {number(i)}
                      </span>
                      {section.heading}
                    </label>
                    <div className={`field ${s.field}`}>
                      <span className="hint" id={hint}>
                        {section.prompt}
                      </span>
                      <textarea
                        key={draft?.updatedAt ?? 'new'}
                        className={`input ${s.textarea}`}
                        id={section.slug}
                        name={section.slug}
                        rows={7}
                        maxLength={PLAN_ANSWER_MAX}
                        defaultValue={answerOf(section.slug)}
                        {...error.input}
                      />
                      <FieldError field={error} className={s.error} />
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className={s.send}>
              <div className={s.row}>
                <button className="btn" type="submit" value="send">
                  Send to {hostFirstName}
                </button>
                <button className="btn ghost" type="submit" value="save">
                  Save draft
                </button>
              </div>
              <p className="small">Sending needs all {sections} sections. Until {hostFirstName} answers, you can take it back to change it.</p>
            </div>
          </form>
        </section>
      )}

      {open?.status === 'sent' && (
        <section className={`wrap ${s.block}`} aria-labelledby="sent-title">
          <div className={s.state}>
            <h2 className="head" id="sent-title">
              With {hostFirstName}
            </h2>
            <p>Sent on {formatDay(open.sentAt)}. {hostFirstName} reads it and answers in writing, and you get the answer by email. Until then, you can take it back to change it.</p>
            <form method="POST" onSubmit={act('back')}>
              <button className="btn ghost" type="submit">
                Take it back to change it
              </button>
            </form>
          </div>
          {unsaved.length > 0 && (
            <div className={s.unsaved}>
              <p>What you just typed was not saved. Copy anything you want to keep.</p>
              {unsaved.map((section) => (
                <div key={section.slug} className="field">
                  <label htmlFor={`unsaved-${section.slug}`}>{section.heading}</label>
                  <textarea className="input" id={`unsaved-${section.slug}`} rows={5} readOnly defaultValue={posted?.[section.slug] ?? ''} />
                </div>
              ))}
            </div>
          )}
          <PlanLetter plan={open} level={3} />
        </section>
      )}

      {!writing && open === null && latest && (
        <section className={`wrap ${s.block}`} aria-label="Your last plan">
          <div className={s.state}>
            <h2 className="head">Answered</h2>
            <p>
              {latest.reply.by ?? hostFirstName} answered your plan on {formatDay(latest.reply.at)}.
            </p>
            <p className={s.row}>
              <a className="btn" href={`/members/plan/${latest.id}`}>
                Read the answer
              </a>
            </p>
          </div>
          <div className={s.state}>
            <h2 className="head">The next plan</h2>
            <p>When you are ready, write the next one. It starts from this plan, so you only change what has moved. The question for {hostFirstName} starts blank.</p>
            <form method="POST" onSubmit={act('start')}>
              <button className="btn ghost" type="submit">
                Start the next plan
              </button>
            </form>
          </div>
        </section>
      )}

      {answered.length > 0 && (
        <section className={`wrap ${s.block}`} aria-labelledby="past-title">
          <h2 className="head" id="past-title">
            Answered plans
          </h2>
          <div className={s.scroll}>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Answered</th>
                  <th>By</th>
                  <th>
                    <span className={s.sr}>Plan</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {answered.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDay(p.sentAt)}</td>
                    <td>{formatDay(p.reply.at)}</td>
                    <td>{p.reply.by ?? hostFirstName}</td>
                    <td>
                      <a href={`/members/plan/${p.id}`}>Read</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
