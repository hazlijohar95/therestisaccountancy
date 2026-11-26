import { matcher } from './search.ts';

/** What a result can be, in the order the search page lists them. */
export const RESULT_KINDS = ['Posts', 'Programmes', 'Products', 'Packs', 'Columns', 'People'] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];

/** One thing on the site that a search can find. */
export interface Entry {
  readonly kind: ResultKind;
  readonly title: string;
  readonly summary: string;
  /** Matched but not shown, like a programme's topics. */
  readonly keywords?: string;
  readonly href: `/${string}` | `https://${string}`;
}

export interface Group {
  readonly kind: ResultKind;
  readonly entries: readonly Entry[];
}

/** The entries with a word that starts with the query, grouped by kind, empty kinds left out. Null when there is nothing to search for. */
export function searchSite(entries: readonly Entry[], query: string): Group[] | null {
  const match = matcher(query);
  if (!match) return null;
  const found = entries.filter((entry) => match.test(`${entry.title} ${entry.summary} ${entry.keywords ?? ''}`));
  return RESULT_KINDS.map((kind) => ({ kind, entries: found.filter((entry) => entry.kind === kind) })).filter((group) => group.entries.length > 0);
}
