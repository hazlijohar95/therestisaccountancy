import { createFileRoute } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { SocialLink, useGo } from '../../../components/social/PathLink.tsx';
import { Tick } from '../../../components/social/Tick.tsx';
import { useAction } from '../../../components/social/useFormAction.ts';
import { confirmWorkEmail, workEmailPage } from '../../../functions/social-ticks.ts';
import { socialSignInHref } from '../../../lib/links.ts';
import { noindex, socialTitle } from '../../../lib/title.ts';

/*
 * The page a work-email link opens. Opening it confirms nothing: mail scanners open links too. The member who asked
 * confirms with a button, signed in, so a link sent to someone else's address can never tick a stranger's claim.
 */
export const Route = createFileRoute('/social/verify/email')({
  validateSearch: (search: Record<string, unknown>) => ({ token: typeof search['token'] === 'string' || typeof search['token'] === 'number' ? String(search['token']) : '' }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => workEmailPage({ data: { token: deps.token } }),
  head: () => ({ meta: [...socialTitle('Confirm your work email'), noindex] }),
  notFoundComponent: Gone,
  component: WorkEmail,
});

function Gone() {
  return (
    <div className="page narrow">
      <section className="panel card" aria-labelledby="title">
        <p className="kicker">Work email</p>
        <h1 className="head" id="title">
          This link no longer works.
        </h1>
        <p>It has been used, a newer one was sent, or seven days have passed. Send a new one from Get ticked.</p>
        <SocialLink className="btn" path="/verify?step=work">
          Get ticked
        </SocialLink>
      </section>
    </div>
  );
}

function WorkEmail() {
  const pending = Route.useLoaderData();
  const { token } = Route.useSearch();
  const go = useGo();
  const confirm = useAction(confirmWorkEmail, { refresh: false });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await confirm.run({ token });
    if (outcome.ok) go('/verify?step=work&done=confirmWorkEmail');
  };

  return (
    <div className="page narrow">
      <section className="panel card" aria-labelledby="title">
        <p className="kicker">Work email</p>
        {pending.viewer === 'signed-out' ? (
          <>
            <h1 className="head" id="title">
              Sign in to confirm.
            </h1>
            <p>
              {pending.name}
              {pending.handle && ` (@${pending.handle})`} asked to show they work at <b>{pending.domain}</b>. If that is you, sign in and confirm.
            </p>
            <a className="btn" href={socialSignInHref(`/verify/email?token=${encodeURIComponent(token)}`)}>
              Sign in
            </a>
            <p className="small">Not you? Close this page. Nothing changes.</p>
          </>
        ) : pending.viewer === 'someone-else' ? (
          <>
            <h1 className="head" id="title">
              This link is for another account.
            </h1>
            <p>You are signed in as {pending.memberName}. Sign in as the person who asked for it, or close this page. Nothing changes.</p>
          </>
        ) : (
          <form method="POST" ref={confirm.form} onSubmit={submit}>
            <h1 className="head" id="title">
              Confirm you work at {pending.domain}.
            </h1>
            <div className="result">
              <Tick source="email" state="pending" />
              <p>Your profile shows “Works at {pending.domain}”. It never shows the address.</p>
            </div>
            {confirm.failure && (
              <p className="error" role="alert">
                {confirm.failure}
              </p>
            )}
            <div className="panel-foot">
              <SocialLink className="btn ghost" path="/verify?step=work">
                Not now
              </SocialLink>
              <button className="btn" type="submit" disabled={confirm.busy}>
                Confirm
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
