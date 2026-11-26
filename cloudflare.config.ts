import { bindings, defineConfig, exports, triggers } from 'cf/config';
import * as entrypoint from './src/worker.ts' with { type: 'cf-worker' };
import { site } from './src/data/site.ts';
import { socialHost } from './src/data/social.ts';

const sender = site.inbox;

export default defineConfig({
  accountId: '9c006d850453ab5c068f5688d138521b',
  worker: {
    name: 'better-accountant',
    compatibilityDate: '2026-11-23',
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    entrypoint,
    env: {
      ASSETS: bindings.assets(),
      EMAIL: bindings.sendEmail({ allowedSenderAddresses: [sender] }),
      MAIL_FROM: bindings.text(sender),
      /**
       * Certificates and licences members upload for the team to check. Each is deleted once its claim is decided; only
       * the decision is kept. Create the bucket before the first deploy rather than relying on cf to make it.
       */
      EVIDENCE: bindings.r2({ name: 'better-accountant-evidence' }),
      /** The admin appointed on start. They set a password with a link from the forgot-password page. */
      ADMIN_EMAIL: bindings.secret(),
      /** CHIP Collect: the secret key and brand from portal.chip-in.asia. Test keys take only test cards. */
      CHIP_SECRET_KEY: bindings.secret(),
      CHIP_BRAND_ID: bindings.secret(),
      /** The public key CHIP signs refund and chargeback webhooks with. Public by nature; from the webhook created for this site. */
      CHIP_WEBHOOK_KEY: bindings.text("-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEArSpMvdbNKsCABZ3ULPfP\n2bMLMtyxd6h3hLu/E5+6x/fXWDDv7/x1hwltN37lJwoZTNxhGeE1BE+yMoc8I7EG\nZhaohY/lll1SPDNO+0GpCDL56vjAFiVrwffhOba0gDqLlebW8tYnTKGAOxl550TX\n+EhqkW+RHxzUFvLWzB9Uk/gwfRusRZeGmsqW/vTta7CY1Cg7Iry8h6Ps/2O9hZkJ\nw0gAszMUQXkfYF6tppPkRlQ55S7+ctH6u7nRkcCreG0Y8hJqcfZM9V10k0PsnTyV\nPw4iauK00oN8/Sg4sBp6VB4N9k3Dv9yEgzAyi+ie8V8L+EtYjWtgs/F/pfX/NE9P\nt/qhEZ4fIlAUBGZveb6/9o0aaZJbG0W7WdSdbPnCvXZktNDzovPLypDfFgSLvrEn\nUilWPmmBmo6VU4qVFAtQmK5phpbU1mewCNfagdsHXiDfvTtCTVN3gG1IgAWcawfU\nrX59W7XJyvxi/md9G3923JUvPTgY1ZhvccqYOp4grxMVAgMBAAE=\n-----END PUBLIC KEY-----"),
    },
    exports: {
      ClubStore: exports.durableObject({ storage: 'sqlite' }),
    },
    /** Hourly: session reminders, and the digest on Monday mornings. */
    triggers: [triggers.scheduled({ schedule: '0 * * * *' })],
    domains: [site.domain, `www.${site.domain}`, socialHost],
    /*
     * Pages go through the Worker first, so the social host can serve its own page at a path the club has prerendered,
     * like /. Built files under /_astro never differ by host and skip the Worker.
     */
    assets: { runWorkerFirst: ['/*', '!/_astro/*'] },
    workersDev: false,
    observability: { enabled: true },
  },
});
