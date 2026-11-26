import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SEARCH_MAX } from '../../../src/lib/search.ts';
import { Page } from '../components/club/Page.tsx';
import { PageHead } from '../components/club/PageHead.tsx';
import { siteSearch } from '../functions/site-search.ts';
import { clubTitle, noindex } from '../lib/title.ts';
import s from './search.module.css';

export const Route = createFileRoute('/search')({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  loader: ({ deps }) => siteSearch({ data: { q: deps.q } }),
  head: ({ loaderData }) => ({
    meta: [
      ...clubTitle(loaderData?.query ? `Search: ${loaderData.query}` : 'Search'),
      { name: 'description', content: 'Search The Rest Is Accountancy: posts, programmes, products, packs, columns and people.' },
      ...(loaderData?.query ? [noindex] : []),
    ],
  }),
  component: Search,
});

function Search() {
  const { query, groups, total } = Route.useLoaderData();
  return (
    <Page>
      <PageHead label="Search" title="What are you looking for?">
        <form className={s.find} action="/search" method="get" role="search">
          <label className="visually-hidden" htmlFor="q">
            Search posts, programmes, products and people
          </label>
          <input id="q" name="q" type="search" defaultValue={query} maxLength={SEARCH_MAX} autoComplete="off" placeholder="Posts, programmes, products, people" autoFocus={!query} />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </PageHead>
      <section className={`wrap ${s.results}`} aria-label="Results">
        {groups && (
          <p className={`small ${s.count}`} role="status">
            {total ? `${total} ${total === 1 ? 'result' : 'results'} for “${query}”.` : `Nothing matches “${query}”. Try a shorter word.`}
          </p>
        )}
        {groups?.map((group) => (
          <section key={group.kind} className={s.group} aria-labelledby={`g-${group.kind}`}>
            <h2 className="label" id={`g-${group.kind}`}>
              {group.kind}
            </h2>
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.href}>
                  <a href={entry.href}>{entry.title}</a>
                  <span className="small">{entry.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </Page>
  );
}
