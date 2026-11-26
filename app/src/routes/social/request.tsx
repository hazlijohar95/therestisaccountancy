import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { REQUEST_LIMITS } from '../../../../src/data/social.ts';
import { fieldError, useAction } from '../../components/social/useAction.ts';
import { requestPage, requestToJoin } from '../../functions/social-invites.ts';
import { socialSignInHref } from '../../lib/links.ts';
import { socialTitle } from '../../lib/title.ts';

/* Social is invite-only. Without an invite, people ask here, and the team reads every request. */
export const Route = createFileRoute('/social/request')({
  loader: async () => {
    const { handle } = await requestPage();
    if (handle) throw redirect({ to: '/social/@{$handle}', params: { handle } });
  },
  head: () => ({
    meta: [...socialTitle('Request to join'), { name: 'description', content: 'The Rest Is Accountancy Social is free and invite-only. Ask to join and the team reads every request.' }],
  }),
  component: Request,
});

const FIELDS = ['name', 'email', 'about', 'link'] as const;

function Request() {
  const [form, setForm] = useState({ name: '', email: '', about: '', link: '', trap: '' });
  const [sent, setSent] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const send = useAction(requestToJoin, { refresh: false });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await send.run(form);
    if (!outcome) return;
    if (!outcome.ok) {
      const first = FIELDS.find((field) => outcome.fields[field]);
      if (first) document.getElementById(first)?.focus();
      return;
    }
    /* Already asked: said as news, not as a mistake. */
    if (outcome.value.waiting) setWaiting(outcome.value.waiting);
    else setSent(outcome.value.email);
  };
  const refusal = send.refusal;
  const name = fieldError(refusal, 'name');
  const email = fieldError(refusal, 'email', { hint: 'email-hint' });
  const about = fieldError(refusal, 'about', { hint: 'about-hint' });
  const link = fieldError(refusal, 'link');
  const failure = refusal && Object.keys(refusal.fields).length === 0 ? refusal.message : null;

  if (sent)
    return (
      <div className="page narrow">
        <section className="panel card" aria-labelledby="done-title">
          <p className="kicker">Request sent</p>
          <h1 className="head" id="done-title">
            Thanks. We will be in touch.
          </h1>
          <p>
            Someone on the team reads every request. We email <b>{sent}</b> either way.
          </p>
          <p className="small">If a member sends you an invite in the meantime, it works straight away.</p>
          <Link className="btn sm ghost" to="/social">
            Read the Floor
          </Link>
        </section>
      </div>
    );

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <p className="kicker">Request to join</p>
          <h1 className="title">Ask to join.</h1>
          <p className="lead">Social is free and invite-only, so every account here is one we know. Anyone can read. To post, use an invite, or ask here.</p>
        </div>
      </div>
      {waiting && (
        <p className="note" role="status">
          {waiting}
        </p>
      )}
      <form className="panel card" method="POST" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" required maxLength={60} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={name.invalid} aria-describedby={name.describedBy} />
          {name.error && (
            <span className="error" id={name.errorId}>
              {name.error}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={email.invalid} aria-describedby={email.describedBy} />
          <span className="hint" id="email-hint">
            We reply here. Nobody else sees it.
          </span>
          {email.error && (
            <span className="error" id={email.errorId}>
              {email.error}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="about">Who you are, and where you post</label>
          <input className="input" id="about" name="about" required maxLength={REQUEST_LIMITS.about} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} placeholder="Audit senior in KL. I post on LinkedIn about MFRS." aria-invalid={about.invalid} aria-describedby={about.describedBy} />
          <span className="hint" id="about-hint">
            One line is plenty.
          </span>
          {about.error && (
            <span className="error" id={about.errorId}>
              {about.error}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="link">A profile of yours · optional</label>
          <input className="input" id="link" name="link" type="url" inputMode="url" maxLength={REQUEST_LIMITS.link} value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://www.linkedin.com/in/…" aria-invalid={link.invalid} aria-describedby={link.describedBy} />
          {link.error && (
            <span className="error" id={link.errorId}>
              {link.error}
            </span>
          )}
        </div>
        <div className="trap" aria-hidden="true">
          <label htmlFor="request-trap">Leave this empty</label>
          <input id="request-trap" name="trap" type="text" tabIndex={-1} autoComplete="off" data-1p-ignore data-lpignore="true" value={form.trap} onChange={(e) => setForm({ ...form, trap: e.target.value })} />
        </div>
        {failure && (
          <p className="error" role="alert">
            {failure}
          </p>
        )}
        <div className="panel-foot">
          <span className="small">
            Have an account? <a href={socialSignInHref('/me')}>Sign in</a>.
          </span>
          <button className="btn" type="submit">
            Send request
          </button>
        </div>
      </form>
    </div>
  );
}
