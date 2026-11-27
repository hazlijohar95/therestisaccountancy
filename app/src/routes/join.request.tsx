import { createFileRoute, redirect } from '@tanstack/react-router';
import { join, joinSection } from '../../../src/data/club.ts';
import { Page } from '../components/club/Page.tsx';
import { Field, Form } from '../components/ui/Form.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { PageHead } from '../components/ui/PageHead.tsx';
import { joinResult } from '../functions/public-account.ts';
import { wireField } from '../lib/form.ts';
import { clubTitle, noindex } from '../lib/title.ts';

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
  const name = wireField(fields['name'], { id: 'join-name-error' });
  const email = wireField(fields['email'], { id: 'join-email-error' });
  return (
    <Page>
      <PageHead
        label={joinSection.label}
        title="Not sent yet."
        aside={
          <Form action="/join" noValidate>
            <Field label="Your name" id="join-name" field={name}>
              <input
                className="input"
                id="join-name"
                name="name"
                autoComplete="name"
                maxLength={60}
                required
                defaultValue={posted['name'] ?? ''}
                {...name.input}
                autoFocus={fields['name'] !== undefined}
              />
            </Field>
            <Field label="Work email" id="join-email" field={email}>
              <input
                className="input"
                id="join-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue={posted['email'] ?? ''}
                {...email.input}
                autoFocus={fields['email'] !== undefined && fields['name'] === undefined}
              />
            </Field>
            <Field label="Where you are" id="join-stage">
              <select className="input" id="join-stage" name="stage" defaultValue={posted['stage'] ?? joinSection.stages[0]}>
                {joinSection.stages.map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </Field>
            <div className="visually-hidden" aria-hidden="true">
              <label htmlFor="join-trap">Leave this empty</label>
              <input id="join-trap" name="trap" type="text" tabIndex={-1} autoComplete="off" data-1p-ignore data-lpignore="true" />
            </div>
            <Notice tone="error" inline id="join-error">
              {result.message}
            </Notice>
            <button className="btn" type="submit">
              {join.label}
            </button>
          </Form>
        }
      />
    </Page>
  );
}
