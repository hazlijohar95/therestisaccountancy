import { bindings, defineConfig, exports, triggers } from 'cf/config';
import * as entrypoint from './src/worker.ts' with { type: 'cf-worker' };

const sender = 'club@better-accountant.com';

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
      /** The admin appointed on start. They set a password with a link from the forgot-password page. */
      ADMIN_EMAIL: bindings.secret(),
      /** CHIP Collect: the secret key and brand from portal.chip-in.asia. Test keys take only test cards. */
      CHIP_SECRET_KEY: bindings.secret(),
      CHIP_BRAND_ID: bindings.secret(),
    },
    exports: {
      ClubStore: exports.durableObject({ storage: 'sqlite' }),
    },
    /** Hourly: session reminders, and the digest on Monday mornings. */
    triggers: [triggers.scheduled({ schedule: '0 * * * *' })],
    domains: ['better-accountant.com', 'www.better-accountant.com'],
    workersDev: false,
    observability: { enabled: true },
  },
});
