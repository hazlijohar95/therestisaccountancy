import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SEARCH_MAX } from '../../../src/lib/search.ts';
import { Page } from '../components/club/Page.tsx';
import { List, Row } from '../components/ui/List.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { PageHead } from '../components/ui/PageHead.tsx';
import { Section } from '../components/ui/Section.tsx';
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
      <PageHead
        label="Search"
        title="What are you looking for?"
        actions={
          <form className={s.find} action="/search" method="get" role="search">
            <label className="visually-hidden" htmlFor="q">
              Search posts, programmes, products and people
            </label>
            <input id="q" name="q" type="search" defaultValue={query} maxLength={SEARCH_MAX} autoComplete="off" placeholder="Posts, programmes, products, people" autoFocus={!query} />
            <button className="btn" type="submit">
              Search
            </button>
          </form>
        }
      />
      {groups && (
        <section aria-label="Results">
          <Notice tone="info">{total ? `${total} ${total === 1 ? 'result' : 'results'} for “${query}”.` : `Nothing matches “${query}”. Try a shorter word.`}</Notice>
          {groups.map((group) => (
            <Section key={group.kind} title={group.kind} meta={group.entries.length}>
              <List>
                {group.entries.map((entry) => (
                  <Row key={entry.href} title={<a href={entry.href}>{entry.title}</a>} meta={entry.summary} />
                ))}
              </List>
            </Section>
          ))}
        </section>
      )}
    </Page>
  );
}
