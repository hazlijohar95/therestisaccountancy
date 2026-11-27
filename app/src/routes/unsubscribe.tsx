import { createFileRoute } from '@tanstack/react-router';
import { Page } from '../components/club/Page.tsx';
import { linkTextParam } from '../lib/search-params.ts';
import { clubTitle, noindex } from '../lib/title.ts';
import s from './unsubscribe.module.css';

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

  return (
    <Page signup={false}>
      <section className={`wrap ${s.block}`} aria-labelledby="page-title">
        {!list ? (
          <>
            <h1 className="head" id="page-title">
              That link is not complete.
            </h1>
            <p>Open the unsubscribe link at the bottom of the latest email again, or reply to that email and ask us to stop.</p>
          </>
        ) : search.done ? (
          <>
            <h1 className="head" id="page-title">
              {copy[list].done}
            </h1>
            {list === 'newsletter' ? (
              <p>
                Changed your mind? <a href="/newsletter">Subscribe again</a>.
              </p>
            ) : list === 'onboarding' ? (
              <p>
                The sessions are still on <a href="/members/sessions">the sessions page</a> whenever you want one.
              </p>
            ) : (
              <p>
                Change your mind any time in <a href="/members/account#email">your account</a>.
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="head" id="page-title">
              {copy[list].ask}
            </h1>
            <form method="POST" action={`/unsubscribe?k=${encodeURIComponent(key)}&list=${list}`}>
              <input type="hidden" name="from" value="page" />
              <button className="btn" type="submit">
                Unsubscribe
              </button>
            </form>
            {list !== 'newsletter' && <p className="small">Emails about your membership, sign-in and sessions you said you would come to still arrive.</p>}
          </>
        )}
      </section>
    </Page>
  );
}
