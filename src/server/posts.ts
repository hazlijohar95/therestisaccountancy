import { getCollection, type CollectionEntry } from 'astro:content';
import type { AuthorHandle } from '../data/authors.ts';
import type { ColumnSlug } from '../data/columns.ts';
import type { ProgrammeSlug } from '../data/programmes.ts';

export type Post = CollectionEntry<'posts'>;

/** Drafts are for the writer's own preview. A production build never has them. */
const published = (post: Post) => !(import.meta.env.PROD && post.data.draft);
const newestFirst = (a: Post, b: Post) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id);

async function postsWhere(keep: (post: Post) => boolean): Promise<Post[]> {
  return (await getCollection('posts', (post) => published(post) && keep(post))).sort(newestFirst);
}

/** Every post, newest first. */
export const allPosts = () => postsWhere(() => true);
export const postsInColumn = (column: ColumnSlug) => postsWhere((post) => post.data.column === column);
export const postsBy = (handle: AuthorHandle) => postsWhere((post) => post.data.authors.includes(handle));
export const postsAbout = (programme: ProgrammeSlug) => postsWhere((post) => post.data.topics.includes(programme));

export async function postAt(column: string, slug: string): Promise<Post | undefined> {
  const [post] = await postsWhere((p) => p.data.column === column && p.id === slug);
  return post;
}

export const postPath = (post: Pick<Post, 'id'> & { data: { column: ColumnSlug } }) => `/${post.data.column}/${post.id}` as const;
