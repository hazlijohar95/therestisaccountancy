import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { site as club } from './src/data/site.ts';
import { socialHost } from './src/data/social.ts';

/* The public address. Emailed links are built on it, never on a request's Host header. */
const site = process.env.SITE_URL ?? `https://${club.domain}`;

/*
 * One sign-in for the club and social hosts: a built site sets the session cookie on the whole domain. A dev server
 * leaves it on the host, since browsers refuse a cookie for a domain the page is not on. The name is new so a host-only
 * cookie from before cannot shadow the shared one; everyone signs in once more.
 */
const siteHost = new URL(site).hostname;
const cookieDomain = process.env.NODE_ENV === 'production' && siteHost !== 'localhost' ? siteHost.replace(/^www\./, '') : undefined;

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
  session: { cookie: { name: 'session', ...(cookieDomain ? { domain: cookieDomain } : {}) } },
  security: {
    allowedDomains: [{ hostname: 'localhost' }, { hostname: siteHost }, { hostname: socialHost }],
  },
});
