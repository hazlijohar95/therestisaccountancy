import handler from '@astrojs/cloudflare/entrypoints/server';
import { paymentCallback, refundWebhook } from './server/chip-routes.ts';
import { hourly } from './server/jobs.ts';
import { socialRoute } from './server/paths.ts';
import { unsubscribe } from './server/unsubscribe.ts';

export { ClubStore } from './server/store.ts';

/** POSTs from outside the site (CHIP, mail apps) that Astro's cross-site check would refuse. Each carries its own proof. */
const outside: Record<string, (request: Request) => Promise<Response>> = {
  '/chip/callback': paymentCallback,
  '/chip/webhook': refundWebhook,
  '/unsubscribe': unsubscribe,
};

export default {
  fetch: (request, env, ctx) => {
    const url = new URL(request.url);
    const route = request.method === 'POST' ? outside[url.pathname] : undefined;
    if (route) return route(request);
    /*
     * The social host's pages live under /social. The rewrite happens here, before Astro picks a route, because Astro
     * would otherwise serve the club's prerendered page for paths like / that both hosts share.
     */
    const social = socialRoute(url);
    return handler.fetch(social ? new Request(social, request) : request, env, ctx);
  },
  scheduled: (controller, _env, ctx) => ctx.waitUntil(hourly(new Date(controller.scheduledTime), import.meta.env.SITE)),
} satisfies ExportedHandler<Env>;
