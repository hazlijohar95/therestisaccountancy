import node from '@astrojs/node';
import { defineConfig, envField } from 'astro/config';

/* The public address, e.g. https://therestisaccountancy.com. Read from the environment at build time.
   Invitation links use it, and its host joins localhost as a host whose requests Astro trusts. */
const site = process.env.SITE_URL;

export default defineConfig({
  site,
  adapter: node({ mode: 'standalone' }),
  security: {
    allowedDomains: [{ hostname: 'localhost' }, ...(site ? [{ hostname: new URL(site).hostname }] : [])],
  },
  env: {
    schema: {
      DATABASE_PATH: envField.string({ context: 'server', access: 'secret', default: 'data/club.sqlite' }),
    },
  },
});
