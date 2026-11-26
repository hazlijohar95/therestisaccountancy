import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SocialLink } from '../../components/social/SocialLink.tsx';
import { type FormEvent } from 'react';
import { z } from 'zod';
import { SEARCH_MAX } from '../../../../src/lib/search.ts';
import { Avatar } from '../../components/social/Avatar.tsx';
import { searchResults } from '../../functions/social-floor.ts';
import { socialHref } from '../../lib/links.ts';
import { noindex, socialTitle } from '../../lib/title.ts';

/*
 * People and posts. The header's search dialog asks this address for JSON; anything else gets the page, which is also
 * where the search button goes without a script. Links are built for the host the page is on.
 */
export const Route = createFileRoute('/social/search')({
  /* The router reads 2024 as a number and true as a boolean, so every value counts as text here. */
  validateSearch: z.object({ q: z.union([z.string(), z.number(), z.boolean()]).transform(String).optional().catch(undefined) }),
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        if (!(request.headers.get('accept') ?? '').includes('application/json')) return next();
        const results = await searchResults({ data: new URL(request.url).searchParams.get('q') ?? '' });
        return new Response(JSON.stringify(results), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', vary: 'Accept, Cookie' },
        });
      },
    },
  },
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  loader: ({ deps }) => searchResults({ data: deps.q }),
  head: ({ loaderData }) => ({ meta: [...socialTitle(loaderData?.query ? `Search: ${loaderData.query}` : 'Search'), noindex] }),
  component: Search,
});

function Search() {
  const { query, people, posts } = Route.useLoaderData();
  const navigate = useNavigate();
  const found = people.length + posts.length;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q') ?? '');
    void navigate({ to: '/social/search', search: { q } });
  };
  return (
    <div className="page narrow search-page">
      <div className="page-head">
        <div>
          <p className="kicker">Search</p>
          <h1 className="title">People and posts.</h1>
        </div>
      </div>
      <form method="GET" action={socialHref('/search')} role="search" onSubmit={submit}>
        <label className="sr-only" htmlFor="search-page-q">
          Search people and posts
        </label>
        <input className="input" id="search-page-q" name="q" type="search" maxLength={SEARCH_MAX} defaultValue={query} key={query} placeholder="A name, a handle, a topic, or words from a post" autoComplete="off" spellCheck={false} autoFocus={!query} />
        <button className="btn" type="submit">
          Search
        </button>
      </form>
      {query.trim() && (
        <div className="search-results">
          <p className="small" role="status">
            {found === 0 ? `No matches for “${query}”.` : `${found} ${found === 1 ? 'result' : 'results'}.`}
          </p>
          {people.length > 0 && (
            <section aria-labelledby="people-title">
              <h2 className="kicker" id="people-title">
                People
              </h2>
              <ul>
                {people.map((p) => (
                  <li key={p.handle}>
                    <SocialLink to="/social/@{$handle}" params={{ handle: p.handle }}>
                      <Avatar name={p.name} track={p.track} sealed={p.sealed} size="sm" />
                      <span>
                        <b>{p.name}</b>{' '}
                        <span className="small">
                          @{p.handle}
                          {p.topics.length > 0 && ` · ${p.topics.join(', ')}`}
                        </span>
                      </span>
                    </SocialLink>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {posts.length > 0 && (
            <section aria-labelledby="posts-title">
              <h2 className="kicker" id="posts-title">
                Posts
              </h2>
              <ul>
                {posts.map((p) => (
                  <li key={p.href}>
                    <a href={p.href}>
                      <svg className="ic" aria-hidden="true" width="18" height="18">
                        <use href="#i-reply" />
                      </svg>
                      <span>{p.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {found === 0 && (
            <p>
              Know someone who posts about it? <SocialLink to="/social/nominate">Nominate them</SocialLink>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
