import { createFileRoute, redirect } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { isSocialHost, safeNext } from '../../../src/server/paths.ts';
import { Page } from '../components/club/Page.tsx';
import { Field, Form } from '../components/ui/Form.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { PageHead } from '../components/ui/PageHead.tsx';
import { Points } from '../components/ui/Points.tsx';
import { useAction } from '../components/useAction.ts';
import { signIn } from '../functions/auth.ts';
import { wireField } from '../lib/form.ts';
import { socialHref } from '../lib/links.ts';
import { clubTitle, noindex } from '../lib/title.ts';

export const Route = createFileRoute('/sign-in')({
  validateSearch: z.object({ next: z.string().optional(), out: z.literal(1).optional() }),
  beforeLoad: ({ context, search }) => {
    const next = safeNext(search.next ?? null);
    if (context.member && !search.out) throw redirect({ href: home(next, context.member) });
  },
  head: () => ({ meta: [...clubTitle('Sign in'), noindex] }),
  component: SignIn,
});

/** With nowhere asked for, a member goes home: admins to the admin page, people only on Social to their profile. */
function home(next: string, member: { role: 'member' | 'admin'; clubApproved: boolean }): string {
  if (next !== '/members') return next;
  if (!member.clubApproved) return socialHref('/me');
  return member.role === 'admin' ? '/admin' : next;
}

function SignIn() {
  const search = Route.useSearch();
  const next = safeNext(search.next ?? null);
  const send = useAction(signIn, { refresh: 'never' });
  /* Sign-in never says which field was wrong, so its one message describes the email field. */
  const problem = wireField(send.refusal?.message, { id: 'form-error' });
  /* One account signs in to the club and to Social. Coming from Social, the page says so. */
  const forSocial = next.startsWith('/social') || (next.startsWith('http') && isSocialHost(new URL(next).hostname));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outcome = await send.run({ email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') });
    if (!outcome?.ok) return;
    /* A full load, so every part of the page, and the other host, sees the new session. */
    window.location.assign(home(next, outcome.value));
  };

  return (
    <Page>
      <PageHead
        label={forSocial ? 'Social' : 'Members'}
        title={forSocial ? 'Sign in to Social.' : 'Sign in to the club.'}
        lead={forSocial ? 'One account for Social and the club. Just joined? Set a password from the link we emailed first.' : 'New member? Set a password from your invitation link first.'}
        aside={
          <Form onSubmit={submit} noValidate>
            {search.out && <Notice inline>You have signed out.</Notice>}
            <Field label="Email" id="email">
              <input className="input" id="email" name="email" type="email" autoComplete="username" required {...problem.input} />
            </Field>
            <Field label="Password" id="password">
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
            </Field>
            {problem.error && (
              <Notice tone="error" inline id={problem.errorId}>
                {problem.error}
              </Notice>
            )}
            <button className="btn" type="submit" disabled={send.busy}>
              Sign in
            </button>
            <Points
              items={[
                { icon: 'mail', text: <a href="/forgot">Forgot your password or lost your invitation? Get a new link.</a> },
                forSocial
                  ? { icon: 'users', text: <>Social is invite-only. Use your link, or <a href={socialHref('/request')}>request to join</a>.</> }
                  : { icon: 'users', text: <a href="/join">Not a member? Request membership.</a> },
              ]}
            />
          </Form>
        }
      />
    </Page>
  );
}
