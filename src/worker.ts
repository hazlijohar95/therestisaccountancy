import handler from '@astrojs/cloudflare/entrypoints/server';
import { hourly } from './server/jobs.ts';
import { unsubscribe } from './server/unsubscribe.ts';

export { ClubStore } from './server/store.ts';

export default {
  fetch: (request, env, ctx) =>
    request.method === 'POST' && new URL(request.url).pathname === '/unsubscribe' ? unsubscribe(request) : handler.fetch(request, env, ctx),
  scheduled: (controller, _env, ctx) => ctx.waitUntil(hourly(new Date(controller.scheduledTime), import.meta.env.SITE)),
} satisfies ExportedHandler<Env>;
