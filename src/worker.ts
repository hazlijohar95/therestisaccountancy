import handler from '@astrojs/cloudflare/entrypoints/server';
import { hourly } from './server/jobs.ts';

export { ClubStore } from './server/store.ts';

export default {
  fetch: handler.fetch,
  scheduled: (controller, _env, ctx) => ctx.waitUntil(hourly(new Date(controller.scheduledTime), import.meta.env.SITE)),
} satisfies ExportedHandler<Env>;
