/*
 * The people on the podcast and in the newsletter. A post names its people by handle; each has a page at /@<handle>.
 * Kept apart from their photos (author-photos.ts) because the posts collection validates against these handles.
 * A new co-host is their handle in authorHandles and their name in authors, plus a photo in author-photos.ts if they
 * have one. Then list them in an episode's authors.
 */

export const authorHandles = ['hazli', 'abu', 'shukri'] as const;
export type AuthorHandle = (typeof authorHandles)[number];

export interface Author {
  readonly handle: AuthorHandle;
  readonly name: string;
}

const hazli: Author = { handle: 'hazli', name: 'Hazli Johar' };

export const authors: readonly Author[] = [hazli, { handle: 'abu', name: 'Abu Musa' }, { handle: 'shukri', name: 'Shukri Yusof' }];

/** The one host, of the podcast and of the club. Everyone else on an episode is that episode's co-host. */
export const host: Author = hazli;
/** How members' pages name the host: "Book a call with Hazli". */
export const hostFirstName = host.name.split(' ')[0];

export type Role = 'Host' | 'Co-host';
export const roleOf = (author: Pick<Author, 'handle'>): Role => (author.handle === host.handle ? 'Host' : 'Co-host');

export const authorPath = (author: Pick<Author, 'handle'>) => `/@${author.handle}` as const;

export function authorByHandle(handle: string): Author | undefined {
  return authors.find((a) => a.handle === handle);
}
