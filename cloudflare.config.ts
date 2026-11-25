import { bindings, defineConfig, exports } from 'cf/config';
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
    },
    exports: {
      ClubStore: exports.durableObject({ storage: 'sqlite' }),
    },
    observability: { enabled: true },
  },
});
