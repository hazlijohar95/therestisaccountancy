import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Page } from '../components/club/Page.tsx';
import { Field, Form } from '../components/ui/Form.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { PageHead } from '../components/ui/PageHead.tsx';
import { Points } from '../components/ui/Points.tsx';
import { useAction } from '../components/useAction.ts';
import { requestLink } from '../functions/public-account.ts';
import { wireField } from '../lib/form.ts';
import { clubTitle, noindex } from '../lib/title.ts';

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

  if (sentTo) {
    return (
      <Page>
        <PageHead
          label="Members"
          title="Check your email."
          lead={<span role="status">If {sentTo} belongs to a member, a link is on its way. It works once.</span>}
          actions={
            <a className="btn ghost" href="/sign-in">
              Back to sign in
            </a>
          }
          aside={
            <Points
              items={[
                { icon: 'mail', text: 'Nothing after a few minutes? Check your spam folder.' },
                { icon: 'clock', text: 'One new link every ten minutes.' },
              ]}
            />
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHead
        label="Members"
        title="Get a new link."
        lead="Forgot your password, or lost your invitation? We email a link that sets a new password."
        aside={
          <Form onSubmit={submit}>
            <Field label="Email you joined with" id="email">
              <input ref={email} className="input" id="email" name="email" type="email" autoComplete="username" required {...problem.input} />
            </Field>
            {problem.error && (
              <Notice tone="error" inline id={problem.errorId}>
                {problem.error}
              </Notice>
            )}
            <button className="btn" type="submit" disabled={send.busy}>
              Email me a link
            </button>
            <a href="/sign-in">Back to sign in</a>
          </Form>
        }
      />
    </Page>
  );
}
