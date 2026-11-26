import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

/*
 * CPE: the app as static assets, and its API under /api in this Worker. Who is signed in always comes from the club
 * Worker over a service binding. Create the R2 bucket and set the secret before the first deploy (see PRODUCTION.md).
 * CLUB_WORKER and CLUB_URL point a dev server at a local club; production uses the defaults.
 */
export default defineConfig({
  accountId: "9c006d850453ab5c068f5688d138521b",
  worker: {
    name: "therestisaccountancy-cpe",
    compatibilityDate: "2026-11-23",
    entrypoint,
    env: {
      ASSETS: bindings.assets(),
      CLUB: bindings.worker({ worker: process.env.CLUB_WORKER ?? "better-accountant", exportName: "CpeIdentity" }),
      AUDIO: bindings.r2({ name: "therestisaccountancy-cpe-audio" }),
      CLUB_URL: bindings.text(process.env.CLUB_URL ?? "https://therestisaccountancy.com"),
      ELEVENLABS_API_KEY: bindings.secret(),
    },
    exports: {
      CatalogueStore: exports.durableObject({ storage: "sqlite" }),
      LearnerStore: exports.durableObject({ storage: "sqlite" }),
    },
    assets: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*"] },
    domains: ["cpe.therestisaccountancy.com"],
    workersDev: false,
    observability: { enabled: true },
  },
});
