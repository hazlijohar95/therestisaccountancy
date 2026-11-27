import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { capitalised, firstName } from '../../../../src/lib/format.ts';
import { useAction } from '../../components/useAction.ts';
import { PlanLetter } from '../../components/club/PlanLetter.tsx';
import { Empty } from '../../components/ui/Empty.tsx';
import { Field, Form } from '../../components/ui/Form.tsx';
import { Meta } from '../../components/ui/List.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Points } from '../../components/ui/Points.tsx';
import { Section } from '../../components/ui/Section.tsx';
import { Table } from '../../components/ui/Table.tsx';
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
      <PageHead label="Admin" title={data.title} lead="Read each plan, then answer in writing." />

      {sent?.ok && <Notice>Answer sent. The member has it by email, from you.</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {refusal && !failure && <Notice tone="error">Your answer was not sent. The note under it says why.</Notice>}
      {unsent && (
        <Section title="Not sent">
          <div className={s.wide}>
            <Field label="Your answer, not sent. Copy it to keep it." id="unsent">
              <textarea className="input" id="unsent" rows={8} readOnly value={unsent} />
            </Field>
          </div>
        </Section>
      )}

      <Section title="Waiting for an answer">
        <Points
          items={[
            { icon: 'file', text: 'Members send a plan once every section is written' },
            { icon: 'mail', text: 'Your answer goes to them by email, from you' },
            { icon: 'lock', text: 'Answering closes the plan' },
            { icon: 'repeat', text: 'Until then they can take it back to change it' },
          ]}
        />
        {waiting.length === 0 ? (
          <Empty icon="file">Nothing waiting. Plans land here as members send them, the longest waiting first.</Empty>
        ) : (
          <>
            <Table label="Plans waiting">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Sent</th>
                  <th>Waiting</th>
                  <th>
                    <span className="visually-hidden">Plan</span>
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
            </Table>
            {waiting.map((p) => {
              const id = `reply-${p.id}`;
              const reply = wireField(refusal?.plan === p.id ? refusal.fields['reply'] : undefined, { id: `${id}-error`, hint: `${id}-hint` });
              return (
                <article className={s.plan} id={`plan-${p.id}`} aria-labelledby={`plan-${p.id}-title`} key={p.id}>
                  <header className={s.who}>
                    <h3 className={s.title} id={`plan-${p.id}-title`}>
                      <Link to="/admin/members/$id" params={{ id: String(p.member.id) }}>
                        {p.member.name}
                      </Link>
                    </h3>
                    <div className={`small ${s.meta}`}>
                      <Meta icon="file">Sent {p.sentMoment}</Meta>
                      <Meta icon="clock">Waiting {p.waited}</Meta>
                    </div>
                  </header>
                  <PlanLetter plan={p} level={4} />
                  {refusal?.plan === p.id && failure && (
                    <Notice tone="error" inline>
                      {failure}
                    </Notice>
                  )}
                  <Form wide className={s.reply} onSubmit={(event) => void onAnswer(event, p)}>
                    <Field
                      label={`Your answer to ${firstName(p.member.name)}`}
                      id={id}
                      hint="Plain text, a blank line between paragraphs. Sending emails it from you and closes the plan. It cannot be changed after."
                      field={reply}
                    >
                      <textarea className="input" id={id} name="reply" rows={10} required maxLength={data.replyMax} {...reply.input} />
                    </Field>
                    <button className="btn" type="submit" disabled={send.busy}>
                      Send the answer
                    </button>
                  </Form>
                </article>
              );
            })}
          </>
        )}
      </Section>

      <Section title="Answered" meta={answered.length > 0 && answered.length === data.answeredShown ? `The ${data.answeredShown} most recent` : undefined}>
        {answered.length === 0 ? (
          <Empty icon="file">No plans answered yet.</Empty>
        ) : (
          <div className={s.answered}>
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
      </Section>
    </>
  );
}
