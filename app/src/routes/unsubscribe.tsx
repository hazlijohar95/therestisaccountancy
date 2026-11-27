import { createFileRoute } from '@tanstack/react-router';
import { Page } from '../components/club/Page.tsx';
import { PageHead } from '../components/ui/PageHead.tsx';
import { linkTextParam } from '../lib/search-params.ts';
import { clubTitle, noindex } from '../lib/title.ts';

/* Whole sentences per list, so none is built from a fragment. */
const copy = {
  newsletter: { ask: 'Stop the newsletter?', done: 'Done. The newsletter will stop.' },
  digest: { ask: 'Stop the weekly email?', done: 'Done. No more weekly emails.' },
  replies: { ask: 'Stop emails about replies to your posts?', done: 'Done. No more emails about replies to your posts.' },
  onboarding: { ask: 'Stop the getting-started emails?', done: 'Done. No more getting-started emails.' },
} as const;
type List = keyof typeof copy;
const isList = (value: string): value is List => Object.hasOwn(copy, value);

/* The page's button posts to /unsubscribe, which the Worker answers before the app and sends back here with ?done. */
export const Route = createFileRoute('/unsubscribe')({
  validateSearch: (search: Record<string, unknown>): { list?: string; k?: string; done?: true } => ({
    ...(search['list'] !== undefined && { list: linkTextParam(search['list']) }),
    ...(search['k'] !== undefined && { k: linkTextParam(search['k']) }),
    ...('done' in search && { done: true }),
  }),
  head: () => ({ meta: [...clubTitle('Unsubscribe'), noindex] }),
  component: Unsubscribe,
});

function Unsubscribe() {
  const search = Route.useSearch();
  const list = search.list !== undefined && isList(search.list) ? search.list : null;
  const key = search.k ?? '';

  if (!list) {
    return (
      <Page signup={false}>
        <PageHead label="Email" title="That link is not complete." lead="Open the unsubscribe link in the latest email again, or reply to that email and ask us to stop." />
      </Page>
    );
  }

  if (search.done) {
    return (
      <Page signup={false}>
        <PageHead
          label="Email"
          title={copy[list].done}
          lead={list === 'newsletter' ? 'Changed your mind?' : list === 'onboarding' ? 'The sessions are still there whenever you want one.' : 'Change your mind any time in your account.'}
          actions={
            list === 'newsletter' ? (
              <a className="btn ghost" href="/newsletter">
                Subscribe again
              </a>
            ) : list === 'onboarding' ? (
              <a className="btn ghost" href="/members/sessions">
                See the sessions
              </a>
            ) : (
              <a className="btn ghost" href="/members/account#email">
                Email settings
              </a>
            )
          }
        />
      </Page>
    );
  }

  return (
    <Page signup={false}>
      <PageHead
        label="Email"
        title={copy[list].ask}
        lead={list === 'newsletter' ? undefined : 'Emails about your membership, sign-in and sessions you said you would come to still arrive.'}
        actions={
          <form method="POST" action={`/unsubscribe?k=${encodeURIComponent(key)}&list=${list}`}>
            <input type="hidden" name="from" value="page" />
            <button className="btn" type="submit">
              Unsubscribe
            </button>
          </form>
        }
      />
    </Page>
  );
}
