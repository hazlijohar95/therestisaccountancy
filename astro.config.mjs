import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

/* The public address. Emailed links are built on it, never on a request's Host header. */
const site = process.env.SITE_URL ?? 'https://better-accountant.com';

export default defineConfig({
  site,
  /* React renders the emails, on the server only. No page ships React to the browser. */
  integrations: [react()],
  adapter: cloudflare({ imageService: 'compile' }),
  /* The free tools moved under Products, which lists every app and tool. Each tool kept its own address. */
  redirects: { '/tools': '/products' },
  /*
   * Browsers that support light-dark() natively. Older targets make Lightning CSS rewrite it into a polyfill that
   * resolves every colour token once on the page root, so a dark band (.night) inside the light page turns white.
   */
  vite: { build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] } },
  security: {
    allowedDomains: [{ hostname: 'localhost' }, { hostname: new URL(site).hostname }],
  },
});
