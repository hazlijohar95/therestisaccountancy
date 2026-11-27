import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { roomPath } from '../../../../src/data/social.ts';
import { socialHref } from '../../lib/links.ts';

/*
 * Any other path under /members is not found inside its own section, never taken for a post at /$column/$slug. The
 * club's old board, which emails already sent still link to, now lives in the members' room on the Floor.
 */
export const Route = createFileRoute('/members/$')({
  beforeLoad: ({ params }) => {
    const path = params._splat ?? '';
    if (path === 'community' || path.startsWith('community/')) throw redirect({ href: socialHref(roomPath('club')) });
    throw notFound();
  },
});
