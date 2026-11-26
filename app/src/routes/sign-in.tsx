import { createFileRoute, redirect } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { safeNext } from '../../../src/server/paths.ts';
import { Page } from '../components/club/Page.tsx';
import { signIn } from '../functions/auth.ts';
import { socialHref } from '../lib/links.ts';
import { clubTitle, noindex } from '../lib/title.ts';
import s from './sign-in.module.css';

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
  const send = useServerFn(signIn);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* One account signs in to the club and to Social. Coming from Social, the page says so. */
  const forSocial = next.startsWith('/social') || next.startsWith('http');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const outcome = await send({ data: { email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') } });
    setBusy(false);
    if (!outcome.ok) return setError(outcome.message);
    /* A full load, so every part of the page, and the other host, sees the new session. */
    window.location.assign(home(next, outcome.value));
  };

  return (
    <Page>
      <section className="night" aria-labelledby="page-title">
        <div className={`wrap ${s.in}`}>
          <div>
            <p className={`label ${s.top}`}>{forSocial ? 'Social' : 'Members'}</p>
            <h1 className={`headline serif ${s.headline}`} id="page-title">
              {forSocial ? 'Sign in to Social.' : 'Sign in to the club.'}
            </h1>
            <p className={s.lead}>
              {forSocial
                ? 'One account for Social and the club. Just joined? Use the link we emailed to set a password first.'
                : 'New member? Use the link in your invitation to set a password first.'}
            </p>
          </div>
          <form method="POST" className={s.form} onSubmit={submit} noValidate>
            {search.out && (
              <p className={s.note} role="status">
                You have signed out.
              </p>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input className="input" id="email" name="email" type="email" autoComplete="username" required aria-invalid={error ? true : undefined} aria-describedby={error ? 'form-error' : undefined} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {error && (
              <p className={s.error} id="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn" type="submit" disabled={busy}>
              Sign in
            </button>
            <p className={s.small}>
              Forgot your password, or lost your invitation? <a href="/forgot">Get a new link by email</a>.
            </p>
            {forSocial ? (
              <p className={s.small}>
                New here? Social is invite-only. Use the link you were sent, or <a href={socialHref('/request')}>request to join</a>.
              </p>
            ) : (
              <p className={s.small}>
                Not a member yet? <a href="/join">Request membership</a>.
              </p>
            )}
          </form>
        </div>
      </section>
    </Page>
  );
}
