import type { LocationRewrite } from '@tanstack/react-router';
import { isSocialHost } from '../../../src/server/paths.ts';

/*
 * Social's pages live under /social in the route tree. On the social host they are served at the root, so /list
 * there is /social/list here. The router rewrites both ways, on the server and in the browser.
 */
export const SOCIAL = '/social';

const underSocial = (pathname: string) => pathname === SOCIAL || pathname.startsWith(`${SOCIAL}/`);

export const hostRewrite: LocationRewrite = {
  input: ({ url }) => {
    if (!isSocialHost(url.hostname)) return undefined;
    url.pathname = url.pathname === '/' ? SOCIAL : `${SOCIAL}${url.pathname}`;
    return url;
  },
  output: ({ url }) => {
    if (!isSocialHost(url.hostname) || !underSocial(url.pathname)) return undefined;
    url.pathname = url.pathname.slice(SOCIAL.length) || '/';
    return url;
  },
};

/** True for a route-tree path that belongs to Social. */
export const isSocialRoute = underSocial;
