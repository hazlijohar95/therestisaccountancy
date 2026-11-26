import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Page } from '../components/club/Page.tsx';
import { useAction } from '../components/useAction.ts';
import { requestLink } from '../functions/public-account.ts';
import { wireField } from '../lib/form.ts';
import { clubTitle, noindex } from '../lib/title.ts';
/* The same layout as signing in: the page sits beside it in the flow. */
import s from './sign-in.module.css';

export const Route = createFileRoute('/forgot')({
  head: () => ({ meta: [...clubTitle('Get a new link'), noindex] }),
  component: Forgot,
});

function Forgot() {
  const send = useAction(requestLink, { refresh: 'never' });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const email = useRef<HTMLInputElement>(null);
  /* Whatever the refusal, its one message describes the email field. */
  const problem = wireField(send.refusal && (send.refusal.fields['email'] ?? send.refusal.message), { id: 'form-error' });

  useEffect(() => {
    if (problem.error) email.current?.focus();
  }, [problem.error]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outcome = await send.run({ email: String(form.get('email') ?? '') });
    if (!outcome?.ok) return;
    setSentTo(outcome.value.email);
  };

  return (
    <Page>
      <section className="night" aria-labelledby="page-title">
        <div className={`wrap ${s.in}`}>
          <div>
            <p className={`label ${s.top}`}>Members</p>
            <h1 className={`headline serif ${s.headline}`} id="page-title">
              Get a new link.
            </h1>
            <p className={`lead ${s.lead}`}>Forgot your password, or lost your invitation? Enter the email you joined with. We send a link that sets a new password.</p>
          </div>
          {sentTo ? (
            <div className={s.form} role="status">
              <p className={s.note}>If {sentTo} belongs to a member, a link is on its way. It works once.</p>
              <p className={`small ${s.small}`}>Nothing after a few minutes? Check your spam folder. A new link can be sent every ten minutes.</p>
              <p className={`small ${s.small}`}>
                <a href="/sign-in">Back to sign in</a>
              </p>
            </div>
          ) : (
            <form method="POST" className={s.form} onSubmit={submit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  ref={email}
                  className="input"
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  {...problem.input}
                />
              </div>
              {problem.error && (
                <p className={`error ${s.error}`} id={problem.errorId} role="alert">
                  {problem.error}
                </p>
              )}
              <button className="btn" type="submit" disabled={send.busy}>
                Email me a link
              </button>
              <p className={`small ${s.small}`}>
                <a href="/sign-in">Back to sign in</a>
              </p>
            </form>
          )}
        </div>
      </section>
    </Page>
  );
}
