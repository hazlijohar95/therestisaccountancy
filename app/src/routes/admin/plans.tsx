import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { capitalised, firstName } from '../../../../src/lib/format.ts';
import { FieldError } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
import { PlanLetter } from '../../components/club/PlanLetter.tsx';
import { adminPlans, answerPlan } from '../../functions/admin-plans.ts';
import { wireField } from '../../lib/form.ts';
import { failureOf } from '../../lib/outcome.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './plans.module.css';

export const Route = createFileRoute('/admin/plans')({
  loader: () => adminPlans(),
  head: () => ({ meta: clubTitle('Plans · Admin') }),
  component: Plans,
});

/** The last answer sent: done, or refused with the plan it was for, what was typed, and why. */
type Sent = { readonly ok: true } | { readonly ok: false; readonly plan: number; readonly reply: string; readonly message: string; readonly fields: Readonly<Record<string, string>> };

function Plans() {
  const data = Route.useLoaderData();
  const { waiting, answered } = data;
  const send = useAction(answerPlan, { refresh: 'always' });
  const [sent, setSent] = useState<Sent | null>(null);

  const refusal = sent && !sent.ok ? sent : null;
  /* A refusal the form shows beside the answer is about the answer; any other is about the plan. */
  const failure = failureOf(refusal);
  /* A plan still waiting keeps a refused answer in its own box. One that has left the list has it shown back up here. */
  const unsent = failure && refusal && !waiting.some((p) => p.id === refusal.plan) ? refusal.reply : '';

  const onAnswer = async (event: FormEvent<HTMLFormElement>, plan: { id: number; sentAt: string }) => {
    event.preventDefault();
    const form = event.currentTarget;
    const reply = String(new FormData(form).get('reply') ?? '');
    const outcome = await send.run({ plan: plan.id, sentAt: plan.sentAt, reply });
    if (!outcome) return;
    setSent(outcome.ok ? { ok: true } : { ok: false, plan: plan.id, reply, message: outcome.message, fields: outcome.fields });
    if (outcome.ok) window.scrollTo({ top: 0 });
  };

  return (
    <>
      <Masthead label="Admin" title={data.title}>
        <p>
          A member sends their plan once every section is written. Read it, then answer in writing. They get your answer by email, from you, and the plan closes. Until you
          answer, they can take it back to change it.
        </p>
      </Masthead>

      {sent?.ok && <Notice>Answer sent. The member has it by email, from you.</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {refusal && !failure && <Notice tone="error">Your answer was not sent. The note under it says why.</Notice>}
      {unsent && (
        <section className={`wrap ${s.block}`}>
          <div className={`field ${s.unsent}`}>
            <label htmlFor="unsent">Your answer, not sent. Copy it if you want to keep it.</label>
            <textarea className="input" id="unsent" rows={8} readOnly value={unsent} />
          </div>
        </section>
      )}

      <section className={`wrap ${s.block}`} aria-labelledby="waiting-title">
        <h2 className="head" id="waiting-title">
          Waiting for an answer
        </h2>
        {waiting.length === 0 ? (
          <p className={s.empty}>Nothing waiting. Plans appear here as members send them, the one waiting longest first.</p>
        ) : (
          <>
            <div className={s.scroll}>
              <table className={`ledger ${s.ledger}`}>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Sent</th>
                    <th>Waiting</th>
                    <th>
                      <span className={s.sr}>Plan</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to="/admin/members/$id" params={{ id: String(p.member.id) }}>
                          {p.member.name}
                        </Link>
                      </td>
                      <td>{p.sent}</td>
                      <td>{capitalised(p.waited)}</td>
                      <td>
                        <a href={`#plan-${p.id}`}>Read and answer</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {waiting.map((p) => {
              const hint = `reply-${p.id}-hint`;
              const reply = wireField(refusal?.plan === p.id ? refusal.fields['reply'] : undefined, { id: `reply-${p.id}-error`, hint });
              return (
                <article className={s.plan} id={`plan-${p.id}`} aria-labelledby={`plan-${p.id}-title`} key={p.id}>
                  <header className={s.who}>
                    <h3 className={s.title} id={`plan-${p.id}-title`}>
                      <Link to="/admin/members/$id" params={{ id: String(p.member.id) }}>
                        {p.member.name}
                      </Link>
                    </h3>
                    <p className="small">
                      Sent {p.sentMoment}. Waiting {p.waited}.
                    </p>
                  </header>
                  <PlanLetter plan={p} level={4} />
                  {refusal?.plan === p.id && failure && (
                    <p className={s.error} role="alert">
                      {failure}
                    </p>
                  )}
                  <form method="POST" className={s.reply} onSubmit={(event) => void onAnswer(event, p)}>
                    <div className="field">
                      <label htmlFor={`reply-${p.id}`}>Your answer to {firstName(p.member.name)}</label>
                      <textarea
                        className="input"
                        id={`reply-${p.id}`}
                        name="reply"
                        rows={10}
                        required
                        maxLength={data.replyMax}
                        {...reply.input}
                      />
                      <span className="hint" id={hint}>
                        Plain text. Leave a blank line between paragraphs. It goes to them by email, from you, and closes the plan, so it cannot be changed after.
                      </span>
                      <FieldError field={reply} className={s.error} />
                    </div>
                    <button className="btn" type="submit" disabled={send.busy}>
                      Send the answer
                    </button>
                  </form>
                </article>
              );
            })}
          </>
        )}
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="answered-title">
        <h2 className="head" id="answered-title">
          Answered
        </h2>
        {answered.length === 0 ? (
          <p className={s.empty}>No plans answered yet.</p>
        ) : (
          <div className={s.answered}>
            {answered.length === data.answeredShown && <p className="small">The {data.answeredShown} most recent.</p>}
            {answered.map((p) => (
              <details className={s.done} key={p.id}>
                <summary>
                  <b>{p.member.name}</b>
                  <span className="small">
                    Answered {p.reply.day} by {p.reply.by ?? 'a host'}
                  </span>
                </summary>
                <div className={s.body}>
                  <p className="small">
                    <Link to="/admin/members/$id" params={{ id: String(p.member.id) }}>
                      {p.member.name}, on record
                    </Link>
                    . Sent {p.sent}.
                  </p>
                  <PlanLetter plan={p} level={3} />
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
