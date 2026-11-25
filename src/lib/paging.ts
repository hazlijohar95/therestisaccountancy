export interface Paging {
  readonly page: number;
  readonly size: number;
  readonly offset: number;
}

/** Far beyond any real list, and small enough that the offset stays a safe integer for SQLite. */
const MAX_PAGE = 1_000_000;

/** The page asked for in ?page=, from 1. Anything else reads as the first page; anything huge, as MAX_PAGE. */
export const pagingOf = (url: URL, size: number): Paging => {
  const asked = Number(url.searchParams.get('page'));
  const page = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_PAGE) : 1;
  return { page, size, offset: (page - 1) * size };
};

/** At least one page, so an empty list still has a page to show. */
export const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

/** The same URL on another page, keeping every other query parameter but never a form action. */
export const pageHref = (url: URL, page: number) => {
  const target = new URL(url);
  target.searchParams.delete('_action');
  if (page <= 1) target.searchParams.delete('page');
  else target.searchParams.set('page', String(page));
  return `${target.pathname}${target.search}`;
};
