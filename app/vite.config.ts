import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  /* The club's server code, data and styles live in the repository root, shared with the marketing site. */
  server: { fs: { allow: ['..'] } },
  /* As the marketing build does: browsers that resolve light-dark(), so night bands keep their own scheme. */
  build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] },
  /* Astro's static build: the marketing pages, their assets and the site's public files. */
  publicDir: '../.site',
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart({ server: { entry: 'server.ts' } }), react()],
});
