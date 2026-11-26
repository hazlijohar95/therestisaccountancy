import abu from '../../../src/assets/hosts/abu-studio.jpg?url';
import hazli from '../../../src/assets/hosts/hazli-studio.jpg?url';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { authorByHandle, authorPath, host, type Author, type AuthorHandle } from '../../../src/data/authors.ts';
import { columnBySlug, columnPath } from '../../../src/data/columns.ts';
import { programmeBySlug, programmePath } from '../../../src/data/programmes.ts';
import { embedAddress, youtubeId } from '../../../src/lib/youtube.ts';
import { paidAccess } from '../../../src/server/paths.ts';
import { coverOf, postAt } from '../lib/content.server.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/** A post's people, the host first and the co-hosts after "with" when the host is one of several. */
function byline(people: readonly Author[]) {
  const hosted = people.some((p) => p.handle === host.handle) && people.length > 1;
  const ordered = hosted ? [host, ...people.filter((p) => p.handle !== host.handle)] : people;
  return { hosted, authors: ordered.map((author) => ({ name: author.name, href: authorPath(author), photo: photos[author.handle] ?? null })) };
}

/** The authors' portraits. An author without one shows their initial. */
const photos: Partial<Record<AuthorHandle, string>> = { hazli, abu };

/**
 * A newsletter post. A members-only post shows its title and dek to everyone and the rest to paid members alone, so
 * its body, and its episode's player, leave the server only for them.
 */
export const memberPost = createServerFn({ method: 'GET' })
  .validator((input: { column: string; slug: string }) => input)
  .handler(async ({ data }) => {
    const post = postAt(data.column, data.slug);
    const column = post && columnBySlug(post.data.column);
    if (!post || !column) throw notFound();
    const member = await currentMember();
    const open = post.data.access === 'free' || (member !== null && paidAccess(member.role, await withStore(async (store) => store.billing.access(member.id))));
    const listen = post.data.listen;
    /* A members' episode plays here only for members; the video itself stays wherever it is published. */
    const video = open && listen?.youtube ? youtubeId(listen.youtube) : undefined;
    const platforms = listen
      ? [
          { name: 'YouTube', verb: 'Watch on', href: listen.youtube },
          { name: 'Spotify', verb: 'Listen on', href: listen.spotify },
          { name: 'Apple Podcasts', verb: 'Listen on', href: listen.apple },
        ].flatMap((p) => (p.href ? [{ ...p, href: p.href }] : []))
      : [];
    return {
      title: post.data.title,
      dek: post.data.dek,
      date: post.data.date.toISOString(),
      episode: post.data.episode ?? null,
      column: { name: column.name, href: columnPath(column) },
      ...byline(post.data.authors.flatMap((handle) => authorByHandle(handle) ?? [])),
      topics: post.data.topics.flatMap((slug) => {
        const programme = programmeBySlug(slug);
        return programme ? [{ name: programme.name, promise: programme.promise, href: programmePath(programme) }] : [];
      }),
      cover: coverOf(post),
      membersOnly: post.data.access === 'members',
      player: video && listen?.youtube ? { href: listen.youtube, embed: embedAddress(video) } : null,
      platforms,
      body: open ? post.html : null,
      signedIn: member !== null,
    };
  });
