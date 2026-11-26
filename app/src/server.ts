import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { env, WorkerEntrypoint } from 'cloudflare:workers';
import { site } from '../../src/data/site.ts';
import { socialHost } from '../../src/data/social.ts';
import { paymentCallback, refundWebhook } from '../../src/server/chip-routes.ts';
import { identify, sessionToken, type ClubIdentity } from '../../src/server/cpe-identity.ts';
import { hourly } from '../../src/server/jobs.ts';
import { isSocialHost } from '../../src/server/paths.ts';
import { unsubscribe } from '../../src/server/unsubscribe.ts';
import { SOCIAL } from './lib/hosts.ts';
import { withStore } from './lib/store.server.ts';

export { ClubStore } from '../../src/server/store.ts';

/**
 * The club's answer to "who is this?" for the CPE Worker, reachable only through its service binding: a named
 * entrypoint has no public address. CPE forwards the browser's cookie; the session is read as the club's pages read it.
 */
export class CpeIdentity extends WorkerEntrypoint<Env> {
  async member(cookie: string | null): Promise<ClubIdentity | null> {
    const token = sessionToken(cookie);
    if (!token) return null;
    return withStore(async (store) => {
      const key = await store.signIns.key(token);
      const member = key ? await store.club.sessionMember(key) : null;
      return identify(member, (memberId) => store.billing.access(memberId));
    });
  }
}

/** POSTs from outside the site (CHIP, mail apps). Each carries its own proof, so none goes through the origin check. */
const outside: Record<string, (request: Request) => Promise<Response>> = {
  '/chip/callback': paymentCallback,
  '/chip/webhook': refundWebhook,
  '/unsubscribe': unsubscribe,
};

/**
 * Where Astro's static build puts a marketing page: /about is /about.html, / is /index.html. Each segment is encoded the
 * way the asset store keys files, so /@hazli finds /%40hazli.html.
 */
const encoded = (segment: string) => {
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return segment;
  }
};
const marketingFile = (pathname: string) => `${(pathname.replace(/\/+$/, '') || '/index').split('/').map(encoded).join('/')}.html`;

/**
 * The club's host serves its marketing pages as static files and everything else from the app. The social host is all
 * app. On the club's production host, a /social link goes to the social host.
 */
async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const post = request.method === 'POST' ? outside[url.pathname] : undefined;
  if (post) return post(request);
  if (isSocialHost(url.hostname) || (request.method !== 'GET' && request.method !== 'HEAD')) return handler.fetch(request);
  if (url.hostname === site.domain && (url.pathname === SOCIAL || url.pathname.startsWith(`${SOCIAL}/`))) {
    return Response.redirect(`https://${socialHost}${url.pathname.slice(SOCIAL.length) || '/'}${url.search}`, 301);
  }
  const page = await env.ASSETS.fetch(new Request(new URL(marketingFile(url.pathname), url), request));
  if (page.ok) return page;
  /* A club page nobody has is Astro's 404, so the marketing site and the app look the same when a link is wrong. */
  const answer = await handler.fetch(request);
  if (answer.status !== 404) return answer;
  const notFound = await env.ASSETS.fetch(new Request(new URL('/404.html', url), request));
  return notFound.ok ? new Response(notFound.body, { status: 404, headers: notFound.headers }) : answer;
}

const app = createServerEntry({ fetch: route });

export default {
  fetch: (request) => app.fetch(request),
  scheduled: (controller, _env, ctx) => ctx.waitUntil(hourly(new Date(controller.scheduledTime), env.SITE_URL)),
} satisfies ExportedHandler<Env>;
