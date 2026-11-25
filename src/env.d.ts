/// <reference types="@astrojs/cloudflare/types.d.ts" />

// The brand's stylesheet is a side-effect import that Vite bundles. It exports nothing.
declare module '@therestisaccountancy/brand/css' {}

declare namespace App {
  interface Locals {
    /** The signed-in member on pages rendered on demand. Always null on prerendered pages. */
    member: import('./server/club.ts').Member | null;
    /**
     * The club's operations, on pages rendered on demand and in actions. Released when the page starts streaming, so
     * read it in a page's frontmatter or an action, never in a component. Prerendered pages never read it.
     */
    club: import('./server/instance.ts').Store['club'];
    community: import('./server/instance.ts').Store['community'];
    limits: import('./server/instance.ts').Store['limits'];
    mailings: import('./server/instance.ts').Store['mailings'];
    schedule: import('./server/instance.ts').Store['schedule'];
    billing: import('./server/instance.ts').Store['billing'];
    plans: import('./server/instance.ts').Store['plans'];
    calls: import('./server/instance.ts').Store['calls'];
    listings: import('./server/instance.ts').Store['listings'];
    fees: import('./server/instance.ts').Store['fees'];
    newsletter: import('./server/instance.ts').Store['newsletter'];
  }
  interface SessionData {
    signedIn: import('./server/club.ts').SessionKey;
  }
}
