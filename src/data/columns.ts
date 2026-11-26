/*
 * The newsletter's columns. Every post belongs to exactly one, and the column is the first part of its address:
 * /<column>/<post>. A column is a format or a voice, not a topic. Topics are the programmes (a post's `topics`).
 * Kept apart from the page copy because the posts collection validates against these slugs.
 */

import type { CoverTopic } from './cover-topics.ts';

export const columnSlugs = ['essays', 'podcast', 'the-brief', 'tested', 'building', 'club-news'] as const;
export type ColumnSlug = (typeof columnSlugs)[number];

export interface Column {
  readonly slug: ColumnSlug;
  readonly name: string;
  /** One line under the column's name, on its page and wherever it is listed. */
  readonly tagline: string;
  /** The cover a post in this column takes when it has none of its own. */
  readonly cover: CoverTopic;
}

export const columns: readonly Column[] = [
  { slug: 'essays', name: 'Essays', tagline: 'The hosts on the business of a practice.', cover: 'practice' },
  { slug: 'podcast', name: 'Stick to Accounting', tagline: 'The podcast. News, analysis and interviews.', cover: 'podcast' },
  { slug: 'the-brief', name: 'The Brief', tagline: 'Tax, regulation and practice news, digested weekly.', cover: 'tax' },
  { slug: 'tested', name: 'Tested', tagline: 'AI and software, tried on real practice work.', cover: 'ai' },
  { slug: 'building', name: 'Building', tagline: 'How we build our products, in public.', cover: 'data' },
  { slug: 'club-news', name: 'Club news', tagline: 'News about the club.', cover: 'practice' },
];

/** A column's page. The podcast's, /podcast, is its own page; the rest share one. */
export const columnPath = (column: Pick<Column, 'slug'>) => `/${column.slug}` as const;

export function columnBySlug(slug: string): Column | undefined {
  return columns.find((c) => c.slug === slug);
}
