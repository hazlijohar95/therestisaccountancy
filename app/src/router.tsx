import { createRouter } from '@tanstack/react-router';
import { hostRewrite } from './lib/hosts.ts';
import { routeTree } from './routeTree.gen.ts';

export function getRouter() {
  return createRouter({ routeTree, rewrite: hostRewrite, scrollRestoration: true, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
