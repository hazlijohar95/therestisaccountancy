import { createFileRoute, redirect } from '@tanstack/react-router';
import { Page } from '../../components/club/Page.tsx';
import { Field, Form } from '../../components/ui/Form.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { wireField } from '../../lib/form.ts';
import { subscribe } from '../../functions/public-forms.server.ts';
import { newsletterResult } from '../../functions/public-newsletter.ts';
import { clubTitle, noindex } from '../../lib/title.ts';

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
          lead={`If ${result.email} is not on the list already, a confirmation link is on its way. Nothing yet? Check spam.`}
        />
      </Page>
    );
  }
  const email = wireField(result.fields['email'], { id: 'newsletter-error' });
  return (
    <Page signup={false}>
      <PageHead
        label="Newsletter"
        title="Not subscribed yet."
        aside={
          <Form action="/newsletter/subscribe">
            <Field label="Email" id="newsletter-email">
              <input
                className="input"
                id="newsletter-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue={result.posted['email'] ?? ''}
                aria-invalid={email.input['aria-invalid']}
                aria-describedby="newsletter-error"
                autoFocus
              />
              <input type="hidden" name="source" value="newsletter" />
            </Field>
            <Notice tone="error" inline id="newsletter-error">
              {result.fields['email'] ?? result.message}
            </Notice>
            <button className="btn" type="submit">
              Subscribe
            </button>
          </Form>
        }
      />
    </Page>
  );
}
