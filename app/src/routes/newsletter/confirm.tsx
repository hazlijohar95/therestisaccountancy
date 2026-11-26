import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import type { ConfirmRefusal } from '../../../../src/server/newsletter.ts';
import { Page } from '../../components/club/Page.tsx';
import { PageHead } from '../../components/club/PageHead.tsx';
import { confirmNewsletter } from '../../functions/public-newsletter.ts';
import { linkTextParam } from '../../lib/search-params.ts';
import { clubTitle, noindex } from '../../lib/title.ts';

const refusals = {
  expired: (days: number) => ({ title: 'That link has run out.', lead: `Confirmation links work for ${days} days. Subscribe again and we will send a new one.` }),
  unknown: () => ({ title: 'That link does not work.', lead: 'It may be incomplete, or a newer email replaced it. Subscribe again and we will send a new link.' }),
} as const satisfies Record<ConfirmRefusal, (days: number) => { title: string; lead: string }>;

/*
 * Opening the link only shows a button; pressing it confirms. Mail scanners open every link in a letter, so confirming
 * on a plain visit would sign up any address someone typed into the form. Pressing it twice is safe.
 */
export const Route = createFileRoute('/newsletter/confirm')({
  validateSearch: (search: Record<string, unknown>): { token?: string } => (search['token'] === undefined ? {} : { token: linkTextParam(search['token']) }),
  head: () => ({ meta: [...clubTitle('Newsletter'), noindex] }),
  component: Confirm,
});

type Confirmed = Awaited<ReturnType<typeof confirmNewsletter>>;

function Confirm() {
  const token = Route.useSearch().token ?? '';
  const send = useServerFn(confirmNewsletter);
  const [result, setResult] = useState<Confirmed | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setResult(await send({ data: { token } }));
    setBusy(false);
  };

  if (!result && token) {
    return (
      <Page signup={false}>
        <PageHead label="Newsletter" title="Confirm your email." lead="One more step. Press the button and the newsletter starts coming to you.">
          <form method="POST" onSubmit={submit}>
            <button className="btn" type="submit" disabled={busy}>
              Yes, send me the newsletter
            </button>
          </form>
        </PageHead>
      </Page>
    );
  }
  if (result?.ok) {
    return (
      <Page signup={false}>
        <PageHead label="Newsletter" title="You’re on the list." lead={`The newsletter now comes to ${result.email}. Every one has a link at the bottom to stop it.`} />
      </Page>
    );
  }
  const refusal = result ? refusals[result.reason](result.confirmDays) : refusals.unknown();
  return (
    <Page signup={false}>
      <PageHead label="Newsletter" title={refusal.title} lead={refusal.lead}>
        <a className="btn" href="/newsletter">
          Subscribe again
        </a>
      </PageHead>
    </Page>
  );
}
