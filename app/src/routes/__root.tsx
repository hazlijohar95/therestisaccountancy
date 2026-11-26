import brandCss from '@therestisaccountancy/brand/css?url';
import sansFont from '@therestisaccountancy/brand/fonts/instrument-sans-normal-latin.woff2?url';
import serifFont from '@therestisaccountancy/brand/fonts/geist-serif-normal.woff2?url';
import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { site } from '../../../src/data/site.ts';
import globalCss from '../../../src/styles/global.css?url';
import { me } from '../functions/auth.ts';
import appCss from '../styles/app.css?url';
import { isSocialRoute } from '../lib/hosts.ts';

export const Route = createRootRoute({
  beforeLoad: async () => ({ member: await me() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'description', content: site.description },
      { name: 'theme-color', content: '#000000' },
      { title: site.title },
    ],
    links: [
      { rel: 'stylesheet', href: brandCss },
      { rel: 'stylesheet', href: globalCss },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'preload', href: serifFont, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'preload', href: sansFont, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
    ],
  }),
  component: () => (
    <Document>
      <Outlet />
    </Document>
  ),
});

function Document({ children }: { children: ReactNode }) {
  const social = useRouterState({ select: (state) => isSocialRoute(state.location.pathname) });
  return (
    <html lang="en-GB" data-brand={social ? 'social' : 'club'} data-theme="light">
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
