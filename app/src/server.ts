import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { env } from 'cloudflare:workers';
import { site } from '../../src/data/site.ts';
import { socialHost } from '../../src/data/social.ts';
import { paymentCallback, refundWebhook } from '../../src/server/chip-routes.ts';
import { hourly } from '../../src/server/jobs.ts';
import { isSocialHost } from '../../src/server/paths.ts';
import { unsubscribe } from '../../src/server/unsubscribe.ts';
import { SOCIAL } from './lib/hosts.ts';

export { ClubStore } from '../../src/server/store.ts';

/** POSTs from outside the site (CHIP, mail apps). Each carries its own proof, so none goes through the origin check. */
const outside: Record<string, (request: Request) => Promise<Response>> = {
  '/chip/callback': paymentCallback,
  '/chip/webhook': refundWebhook,
  '/unsubscribe': unsubscribe,
};

/** Where Astro's static build puts a marketing page: /about is /_site/about.html, / is /_site/index.html. */
const MARKETING = '/_site';
const marketingFile = (pathname: string) => `${MARKETING}${pathname.replace(/\/+$/, '') || '/index'}.html`;

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
  return page.ok ? page : handler.fetch(request);
}

const app = createServerEntry({ fetch: route });

export default {
  fetch: (request) => app.fetch(request),
  scheduled: (controller, _env, ctx) => ctx.waitUntil(hourly(new Date(controller.scheduledTime), env.SITE_URL)),
} satisfies ExportedHandler<Env>;
