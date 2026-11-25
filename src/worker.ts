import handler from '@astrojs/cloudflare/entrypoints/server';
import { paymentCallback, refundWebhook } from './server/chip-routes.ts';
import { hourly } from './server/jobs.ts';
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
    const route = request.method === 'POST' ? outside[new URL(request.url).pathname] : undefined;
    return route ? route(request) : handler.fetch(request, env, ctx);
  },
  scheduled: (controller, _env, ctx) => ctx.waitUntil(hourly(new Date(controller.scheduledTime), import.meta.env.SITE)),
} satisfies ExportedHandler<Env>;
