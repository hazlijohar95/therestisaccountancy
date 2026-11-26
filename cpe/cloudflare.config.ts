import { defineConfig } from "cf/config";

/** CPE is a static single-page app: served as Worker static assets on its own subdomain, separate from the main site Worker. */
export default defineConfig({
  accountId: "9c006d850453ab5c068f5688d138521b",
  worker: {
    name: "therestisaccountancy-cpe",
    compatibilityDate: "2026-11-23",
    assets: { notFoundHandling: "single-page-application" },
    domains: ["cpe.therestisaccountancy.com"],
    workersDev: false,
    observability: { enabled: true },
  },
});
