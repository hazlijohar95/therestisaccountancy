import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { clubPath, signInPath, socialPath } from '../../../src/server/paths.ts';

/** The address of the page being rendered: the request's on the server, the browser's after. */
const here = createIsomorphicFn()
  .server(() => new URL(getRequest().url))
  .client(() => new URL(window.location.href));

/** A link to a Social page from wherever this page is served: the social host from the club's, /social on a dev host. */
export const socialHref = (path: string) => socialPath(here(), path);

/** A link to a club page (sign-in, password links), which live on the club's host only. */
export const clubHref = (path: string) => clubPath(here(), path);

/** Sign in on the club's host, then come back to the Social page at path. */
export const socialSignInHref = (path: string) => signInPath(here(), path);
