import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LINK_DAYS, type LinkPurpose } from '../../../src/data/links.ts';
import { Page } from '../components/club/Page.tsx';
import { FieldError } from '../components/FieldError.tsx';
import { useAction } from '../components/useAction.ts';
import { passwordLink, setPassword } from '../functions/public-account.ts';
import { socialHref } from '../lib/links.ts';
import { linkTextParam } from '../lib/search-params.ts';
import { clubTitle, noindex } from '../lib/title.ts';
import s from './welcome.module.css';

const copy = {
  welcome: {
    label: 'Invitation',
    title: (name: string) => `Welcome, ${name}.`,
    lead: (email: string) => `Set a password for ${email}. You will use it with that email to sign in.`,
    submit: 'Set password and enter',
  },
  reset: {
    label: 'Password reset',
    title: (name: string) => `Welcome back, ${name}.`,
    lead: (email: string) => `Choose a new password for ${email}. Setting it signs you out on every other device.`,
    submit: 'Set new password and enter',
  },
} as const satisfies Record<LinkPurpose, { label: string; title: (name: string) => string; lead: (email: string) => string; submit: string }>;

export const Route = createFileRoute('/welcome')({
  validateSearch: (search: Record<string, unknown>): { token?: string } => (search['token'] === undefined ? {} : { token: linkTextParam(search['token']) }),
  loaderDeps: ({ search }) => ({ token: search.token ?? '' }),
  loader: ({ deps }) => passwordLink({ data: { token: deps.token } }),
  head: ({ loaderData }) => ({ meta: [...clubTitle(loaderData?.holder ? copy[loaderData.holder.purpose].label : 'Password link'), noindex] }),
  component: Welcome,
});

function Welcome() {
  const { holder, minLength } = Route.useLoaderData();
  const token = Route.useSearch().token ?? '';
  const send = useAction(setPassword, { refresh: 'never' });
  const [leaving, setLeaving] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (send.refusal?.fields['password']) password.current?.focus();
    else if (send.refusal?.fields['confirm']) confirm.current?.focus();
  }, [send.refusal]);

  if (!holder) {
    return (
      <Page>
        <section className="night" aria-labelledby="page-title">
          <div className={`wrap ${s.in}`}>
            <div>
              <p className={`label ${s.top}`}>Members</p>
              <h1 className={`headline serif ${s.headline}`} id="page-title">
                This link no longer works.
              </h1>
              <p className={`lead ${s.lead}`}>
                Each link works once. An invitation lasts {LINK_DAYS.welcome} days and a reset link {LINK_DAYS.reset} days. <a href="/forgot">Get a new link by email</a>, or <a href="/sign-in">sign in</a> if you have set a password since.
              </p>
            </div>
          </div>
        </section>
      </Page>
    );
  }

  const text = copy[holder.purpose];
  const passwordField = send.field('password', { hint: 'password-hint' });
  const confirmField = send.field('confirm');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outcome = await send.run({ token, password: String(form.get('password') ?? ''), confirm: String(form.get('confirm') ?? '') });
    if (!outcome?.ok) return;
    setLeaving(true);
    /* Someone only on the social site goes back there, not to the club's members' area and its payment page. A full load, so every part of the page sees the new session. */
    window.location.assign(outcome.value.clubApproved ? `/members?${outcome.value.purpose}` : socialHref('/me'));
  };

  return (
    <Page>
      <section className="night" aria-labelledby="page-title">
        <div className={`wrap ${s.in}`}>
          <div>
            <p className={`label ${s.top}`}>{text.label}</p>
            <h1 className={`headline serif ${s.headline}`} id="page-title">
              {text.title(holder.firstName)}
            </h1>
            <p className={`lead ${s.lead}`}>{text.lead(holder.email)}</p>
          </div>
          <form method="POST" className={s.form} onSubmit={submit}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="email" value={holder.email} autoComplete="username" />
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                ref={password}
                className="input"
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={minLength}
                required
                {...passwordField.input}
              />
              <span className="hint" id="password-hint">
                At least {minLength} characters. A short sentence works well.
              </span>
              <FieldError field={passwordField} className={s.error} />
            </div>
            <div className="field">
              <label htmlFor="confirm">The same password again</label>
              <input
                ref={confirm}
                className="input"
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                {...confirmField.input}
              />
              <FieldError field={confirmField} className={s.error} />
            </div>
            {send.failure && (
              <p className={`error ${s.error}`} role="alert">
                {send.failure}
              </p>
            )}
            <button className="btn" type="submit" disabled={send.busy || leaving}>
              {text.submit}
            </button>
          </form>
        </div>
      </section>
    </Page>
  );
}
