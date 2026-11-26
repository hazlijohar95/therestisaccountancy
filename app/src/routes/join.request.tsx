import { createFileRoute, redirect } from '@tanstack/react-router';
import { join, joinSection } from '../../../src/data/club.ts';
import { Page } from '../components/club/Page.tsx';
import { PageHead } from '../components/club/PageHead.tsx';
import { Notice } from '../components/public/Notice.tsx';
import { joinResult } from '../functions/public-account.ts';
import { clubTitle, noindex } from '../lib/title.ts';
import s from './join.request.module.css';

/* Where a plain post of the membership request lands: the thanks, or the form again with what was wrong. Shown once. */
export const Route = createFileRoute('/join/request')({
  loader: async () => {
    const result = await joinResult();
    if (!result) throw redirect({ href: '/join' });
    return result;
  },
  head: () => ({ meta: [...clubTitle('Request membership'), noindex] }),
  component: JoinRequest,
});

function JoinRequest() {
  const result = Route.useLoaderData();
  if (result.ok) {
    return (
      <Page>
        <PageHead label={joinSection.label} title="Thank you." lead={joinSection.messages.sent(result.email)} />
      </Page>
    );
  }
  const { fields, posted } = result;
  return (
    <Page>
      <PageHead label={joinSection.label} title="Not sent yet." />
      <Notice tone="error" id="join-error">
        {result.message}
      </Notice>
      <div className="wrap">
        <form className={s.form} method="POST" action="/join" noValidate>
          <div className="field">
            <label htmlFor="join-name">Your name</label>
            <input
              className="input"
              id="join-name"
              name="name"
              autoComplete="name"
              maxLength={60}
              required
              defaultValue={posted['name'] ?? ''}
              aria-invalid={fields['name'] ? true : undefined}
              aria-describedby={fields['name'] ? 'join-name-error' : undefined}
              autoFocus={fields['name'] !== undefined}
            />
            {fields['name'] && (
              <span className="error" id="join-name-error">
                {fields['name']}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="join-email">Work email</label>
            <input
              className="input"
              id="join-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={posted['email'] ?? ''}
              aria-invalid={fields['email'] ? true : undefined}
              aria-describedby={fields['email'] ? 'join-email-error' : undefined}
              autoFocus={fields['email'] !== undefined && fields['name'] === undefined}
            />
            {fields['email'] && (
              <span className="error" id="join-email-error">
                {fields['email']}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="join-stage">Where you are</label>
            <select className="input" id="join-stage" name="stage" defaultValue={posted['stage'] ?? joinSection.stages[0]}>
              {joinSection.stages.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </div>
          <div className={s.trap} aria-hidden="true">
            <label htmlFor="join-trap">Leave this empty</label>
            <input id="join-trap" name="trap" type="text" tabIndex={-1} autoComplete="off" data-1p-ignore data-lpignore="true" />
          </div>
          <button className="btn" type="submit">
            {join.label}
          </button>
        </form>
      </div>
    </Page>
  );
}
