import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

/* The public address. Emailed links are built on it, never on a request's Host header. */
const site = process.env.SITE_URL ?? 'https://better-accountant.com';

export default defineConfig({
  site,
  adapter: cloudflare({ imageService: 'compile' }),
  security: {
    allowedDomains: [{ hostname: 'localhost' }, { hostname: new URL(site).hostname }],
  },
});
