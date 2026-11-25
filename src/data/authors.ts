/*
 * Who writes and hosts. A post names its authors by handle; each has a page at /@<handle>. Kept apart from their
 * photos (author-photos.ts) because the posts collection validates against these handles.
 */

export const authorHandles = ['hazli', 'abu', 'shukri'] as const;
export type AuthorHandle = (typeof authorHandles)[number];

export interface Author {
  readonly handle: AuthorHandle;
  readonly name: string;
  readonly role: string;
}

export const authors: readonly Author[] = [
  { handle: 'hazli', name: 'Hazli Johar', role: 'Host' },
  { handle: 'abu', name: 'Abu Musa', role: 'Host' },
  { handle: 'shukri', name: 'Shukri Yusof', role: 'Host' },
];

export const authorPath = (author: Pick<Author, 'handle'>) => `/@${author.handle}` as const;

export function authorByHandle(handle: string): Author | undefined {
  return authors.find((a) => a.handle === handle);
}
