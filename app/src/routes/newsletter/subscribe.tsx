import { createFileRoute, redirect } from '@tanstack/react-router';
import { Page } from '../../components/club/Page.tsx';
import { PageHead } from '../../components/club/PageHead.tsx';
import { Notice } from '../../components/public/Notice.tsx';
import { subscribe } from '../../functions/public-forms.server.ts';
import { newsletterResult } from '../../functions/public-newsletter.ts';
import { clubTitle, noindex } from '../../lib/title.ts';
import s from './subscribe.module.css';

/* Every sign-up form posts here, so it works from the static pages. The post answers with a 303 back here, where the result shows once. */
export const Route = createFileRoute('/newsletter/subscribe')({
  server: { handlers: { POST: ({ request }) => subscribe(request) } },
  loader: async () => {
    const result = await newsletterResult();
    if (!result) throw redirect({ href: '/newsletter' });
    return result;
  },
  head: () => ({ meta: [...clubTitle('Newsletter'), noindex] }),
  component: Subscribe,
});

function Subscribe() {
  const result = Route.useLoaderData();
  if (result.ok) {
    return (
      <Page signup={false}>
        <PageHead
          label="Newsletter"
          title="Check your inbox to confirm."
          lead={`If ${result.email} is not on the list already, a link to confirm it is on its way. Nothing after a few minutes? Check your spam folder.`}
        />
      </Page>
    );
  }
  const badEmail = result.fields['email'] !== undefined;
  return (
    <Page signup={false}>
      <PageHead label="Newsletter" title="Not subscribed yet." />
      <Notice tone="error" id="newsletter-error">
        {result.fields['email'] ?? result.message}
      </Notice>
      <form className={`wrap ${s.form}`} method="POST" action="/newsletter/subscribe">
        <div className="field">
          <label htmlFor="newsletter-email">Email</label>
          <input
            className="input"
            id="newsletter-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={result.posted['email'] ?? ''}
            aria-invalid={badEmail ? true : undefined}
            aria-describedby="newsletter-error"
            autoFocus
          />
          <input type="hidden" name="source" value="newsletter" />
        </div>
        <button className="btn" type="submit">
          Subscribe
        </button>
      </form>
    </Page>
  );
}
