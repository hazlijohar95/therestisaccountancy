// The brand's stylesheet is a side-effect import that Vite bundles. It exports nothing.
declare module '@therestisaccountancy/brand/css' {}

declare namespace App {
  interface Locals {
    /** The signed-in member on pages rendered on demand. Always null on prerendered pages. */
    member: import('./server/club.ts').Member | null;
  }
  interface SessionData {
    signedIn: import('./server/club.ts').SessionKey;
  }
}
