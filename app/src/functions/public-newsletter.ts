import { createServerFn } from '@tanstack/react-start';
import { CONFIRM_DAYS, type ConfirmRefusal } from '../../../src/server/newsletter.ts';
import { withStore } from '../lib/store.server.ts';
import { NEWSLETTER_RESULT, takeResult } from './public-forms.server.ts';

/** What the newsletter sign-up's plain post did, for /newsletter/subscribe. Read once. */
export const newsletterResult = createServerFn({ method: 'GET' }).handler(async () => takeResult(NEWSLETTER_RESULT));

/** Confirms a subscription from the emailed link. Pressing it twice is safe. */
export const confirmNewsletter = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; email: string } | { ok: false; reason: ConfirmRefusal; confirmDays: number }> => {
    if (!data.token) return { ok: false, reason: 'unknown', confirmDays: CONFIRM_DAYS };
    const result = await withStore(async (store) => await store.newsletter.confirm(data.token));
    return result.ok ? { ok: true, email: result.value.email } : { ok: false, reason: result.reason, confirmDays: CONFIRM_DAYS };
  });
