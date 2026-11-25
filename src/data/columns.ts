/*
 * The newsletter's columns. Every post belongs to exactly one, and the column is the first part of its address:
 * /<column>/<post>. A column is a format or a voice, not a topic. Topics are the programmes (a post's `topics`).
 * Kept apart from the page copy because the posts collection validates against these slugs.
 */

export const columnSlugs = ['essays', 'podcast', 'the-brief', 'tested', 'building', 'club-news'] as const;
export type ColumnSlug = (typeof columnSlugs)[number];

export interface Column {
  readonly slug: ColumnSlug;
  readonly name: string;
  /** One line under the column's name, on its page and wherever it is listed. */
  readonly tagline: string;
}

export const columns: readonly Column[] = [
  { slug: 'essays', name: 'Essays', tagline: 'The hosts on the business of a practice.' },
  { slug: 'podcast', name: 'Stick to Accounting', tagline: 'The podcast. News, analysis and interviews.' },
  { slug: 'the-brief', name: 'The Brief', tagline: 'Tax, regulation and practice news, digested weekly.' },
  { slug: 'tested', name: 'Tested', tagline: 'AI and software, tried on real practice work.' },
  { slug: 'building', name: 'Building', tagline: 'How we build our products, in public.' },
  { slug: 'club-news', name: 'Club news', tagline: 'News about the club.' },
];

/** A column's page. The podcast's, /podcast, is its own page; the rest share one. */
export const columnPath = (column: Pick<Column, 'slug'>) => `/${column.slug}` as const;

export function columnBySlug(slug: string): Column | undefined {
  return columns.find((c) => c.slug === slug);
}
