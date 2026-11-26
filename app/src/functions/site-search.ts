import { createServerFn } from '@tanstack/react-start';
import { authorPath, authors, roleOf } from '../../../src/data/authors.ts';
import { columnPath, columns } from '../../../src/data/columns.ts';
import { products } from '../../../src/data/products.ts';
import { programmePath, programmes } from '../../../src/data/programmes.ts';
import { SEARCH_MAX } from '../../../src/lib/search.ts';
import { searchSite, type Entry } from '../../../src/lib/site-search.ts';
import { allPosts, allResources, type Post } from '../lib/content.server.ts';

const postHref = (post: Post): `/${string}` => `/${post.data.column}/${post.id}`;

/** Programmes that have templates, as the packs pages list them: the pack's name and its programme's promise. */
const packEntries = (): Entry[] =>
  programmes
    .filter((programme) => allResources().some((resource) => resource.data.programme === programme.slug))
    .map((programme) => ({ kind: 'Packs', title: `The ${programme.name} pack`, summary: programme.promise, href: `/packs/${programme.slug}` }));

/** The site's search. Members-only posts are found by their title and dek only, which everyone can already read. */
export const siteSearch = createServerFn({ method: 'GET' })
  .validator((input: { q: string }) => input)
  .handler(({ data }) => {
    const query = data.q.slice(0, SEARCH_MAX);
    const entries: Entry[] = [
      ...allPosts().map((post) => ({ kind: 'Posts' as const, title: post.data.title.replaceAll('*', ''), summary: post.data.dek, href: postHref(post) })),
      ...programmes.map((p) => ({ kind: 'Programmes' as const, title: p.name, summary: p.promise, keywords: p.topics.join(' · '), href: programmePath(p) })),
      ...products.map((p) => ({ kind: 'Products' as const, title: p.name, summary: p.summary, keywords: p.question, href: p.href })),
      ...packEntries(),
      ...columns.map((c) => ({ kind: 'Columns' as const, title: c.name, summary: c.tagline, href: c.slug === 'podcast' ? '/podcast' : columnPath(c) })),
      ...authors.map((a) => ({ kind: 'People' as const, title: a.name, summary: `${roleOf(a)}, Stick to Accounting`, href: authorPath(a) })),
    ];
    const groups = searchSite(entries, query);
    return { query, groups, total: groups?.reduce((n, group) => n + group.entries.length, 0) ?? 0 };
  });
