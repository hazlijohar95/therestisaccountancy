import { createFileRoute, redirect } from '@tanstack/react-router';
import { ownPath } from '../../functions/social-profiles.ts';
import { socialSignInHref } from '../../lib/links.ts';

/* Your own profile, wherever it lives: sign in first, and claim a handle if you have none. */
export const Route = createFileRoute('/social/me')({
  beforeLoad: async () => {
    const own = await ownPath();
    if (!own) throw redirect({ href: socialSignInHref('/me') });
    throw own.handle ? redirect({ to: '/social/@{$handle}', params: { handle: own.handle } }) : redirect({ to: '/social/edit' });
  },
});
