import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  /* The club's server code, data and styles live in the repository root, shared with the marketing site. */
  server: { fs: { allow: ['..'] } },
  publicDir: '../public',
  /* Browsers with light-dark(), as in astro.config.mjs. Older targets polyfill it on the page root, which turns every .night band white. */
  build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] },
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart({ server: { entry: 'server.ts' } }), react()],
});
