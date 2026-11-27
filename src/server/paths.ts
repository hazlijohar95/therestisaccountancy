import { site } from '../data/site.ts';
import { socialHost } from '../data/social.ts';
import type { Access } from './billing.ts';

/** Where a member area belongs, and who may see it. */
export function requiredRole(pathname: string): 'member' | 'admin' | null {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (under('/admin')) return 'admin';
  if (under('/members')) return 'member';
  return null;
}

/** A return path from a query string, kept on this site: a path here, or an address on the social or CPE host. Anything else falls back. */
export function safeNext(value: string | null, fallback = '/members'): string {
  if (!value) return fallback;
  if (value.startsWith('/')) return samePath(value) ? value : fallback;
  return socialAddress(value) ?? cpeAddress(value) ?? fallback;
}

/**
 * True when a path stays on this site however a browser reads it. Browsers drop tabs and line breaks from an address,
 * so /\t/evil.com would become //evil.com; a control character, a backslash or a second leading slash is refused.
 */
const samePath = (path: string) => !path.startsWith('//') && !/[\u0000-\u001f\\]/.test(path);

/** CPE, the listening app on its own subdomain, signs members in here and asks to be sent back. */
export const cpeHost = `cpe.${site.domain}`;

/** The social host, and social.localhost for trying it on a dev server. */
export const isSocialHost = (hostname: string) => hostname === socialHost || hostname === 'social.localhost';

/** An absolute address on the social host, over https (or http on social.localhost), with no credentials. Null for anything else. */
const socialAddress = (value: string) => addressOn(value, socialHost, 'social.localhost');

/** The same for the CPE host, and cpe.localhost for a dev server. */
const cpeAddress = (value: string) => addressOn(value, cpeHost, 'cpe.localhost');

function addressOn(value: string, host: string, devHost: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  const secure = (url.protocol === 'https:' && (url.hostname === host || url.hostname === devHost)) || (url.protocol === 'http:' && url.hostname === devHost);
  return secure && !url.username && !url.password ? url.href : null;
}

/**
 * Where a request on the social host is served from: /x there is the page at /social/x. Astro's own files and
 * endpoints (/_astro, /_actions), files with an extension, and paths already under /social stay as they are, which
 * makes the rewrite safe to apply twice. Null when nothing changes.
 */
export function socialRoute(url: URL): URL | null {
  const path = url.pathname;
  if (!isSocialHost(url.hostname) || path === '/social' || path.startsWith('/social/') || path.startsWith('/_') || /\.[a-z0-9]+$/i.test(path)) return null;
  const target = new URL(url);
  target.pathname = path === '/' ? '/social' : `/social${path}`;
  return target;
}

/** The page's address as the browser sees it: on the social host, without the /social the Worker added. For forms that post back. */
export function addressed(url: URL): URL {
  if (!isSocialHost(url.hostname) || !(url.pathname === '/social' || url.pathname.startsWith('/social/'))) return url;
  const seen = new URL(url);
  seen.pathname = url.pathname.slice('/social'.length) || '/';
  return seen;
}

/** A page under /social, where the Worker has already moved a request on the social host. */
export const isSocialPage = (pathname: string) => pathname === '/social' || pathname.startsWith('/social/');

/** A full address for a social page, for links that leave in an email. siteUrl is the club's configured address. */
export const socialUrl = (siteUrl: string, path: string) => new URL(socialPath(new URL(siteUrl), path), siteUrl).href;

/** Where an emailed password link lands. Emails already sent depend on this path. */
export const welcomeUrl = (siteUrl: string, token: string) => new URL(`/welcome?token=${encodeURIComponent(token)}`, siteUrl).href;

/** Where an emailed Social invite lands: the short sign-up, which also tells a dead link apart. */
export const inviteUrl = (siteUrl: string, token: string) => socialUrl(siteUrl, `/sign-up?invite=${encodeURIComponent(token)}`);

/** Which social page a page under /social is, as socialPath takes it: /social/edit is /edit. */
export const socialPathOf = (url: URL) => url.pathname.replace(/^\/social(?=\/|$)/, '') || '/';

/** The social page at url with its query, less the form action a POST added: where to come back to after signing in. */
export function socialHere(url: URL): string {
  const query = new URLSearchParams(url.search);
  query.delete('_action');
  const search = query.toString();
  return search ? `${socialPathOf(url)}?${search}` : socialPathOf(url);
}

/**
 * A link to a social page from the page at url. Root paths on the social host; the social host itself from the club's
 * own domain; /social/... anywhere else, so a dev server on localhost serves social pages too.
 */
export function socialPath(url: URL, path: string): string {
  if (isSocialHost(url.hostname)) return path;
  if (url.hostname === site.domain || url.hostname === `www.${site.domain}`) return `https://${socialHost}${path}`;
  /* The Floor's own root, with or without a query: /?room=club is /social?room=club, never /social/?room=club. */
  return path === '/' || path.startsWith('/?') ? `/social${path.slice(1)}` : `/social${path}`;
}

/** A link to a club page (sign-in, password links) from the page at url. Those pages live on the club's host only. */
export function clubPath(url: URL, path: string): string {
  return isSocialHost(url.hostname) ? `${url.protocol}//${url.host.replace(/^social\./, '')}${path}` : path;
}

/** Sign in on the club's host, then come back to the social page at path. */
export function signInPath(url: URL, path: string): string {
  const back = isSocialHost(url.hostname) ? `${url.origin}${path}` : socialPath(url, path);
  return clubPath(url, `/sign-in?next=${encodeURIComponent(back)}`);
}

/** Member pages open to a member who has not paid: where they pay, and their account. Admins never pay. */
export const needsPayment = (pathname: string) => !['/members/pay', '/members/account'].includes(pathname.replace(/\/$/, ''));

/** Whether someone may read what membership pays for: an admin always, a member while paid or in grace. */
export const paidAccess = (role: 'member' | 'admin', access: Access) => role === 'admin' || access !== 'unpaid';
