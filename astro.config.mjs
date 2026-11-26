import { defineConfig } from 'astro/config';
import { site as club } from './src/data/site.ts';

/*
 * The marketing pages, built to static files. The app in app/ serves them from .site/ and answers everything that
 * runs per request: sign-in, the members' area, admin and Social. /about is built as about.html, which the app's
 * Worker maps by exact path.
 */
export default defineConfig({
  site: `https://${club.domain}`,
  output: 'static',
  outDir: './.site',
  build: { format: 'file' },
  /* The free tools moved under Products, which lists every app and tool. Each tool kept its own address. */
  redirects: { '/tools': '/products' },
  /*
   * Browsers that support light-dark() natively. Older targets make Lightning CSS rewrite it into a polyfill that
   * resolves every colour token once on the page root, so a dark band (.night) inside the light page turns white.
   */
  vite: { build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] } },
});
