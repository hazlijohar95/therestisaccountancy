import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { checkout } from '../server/payments.ts';
import { report } from '../server/report.ts';
import { absolute, signedIn, throttle } from './guards.ts';

export const billing = {
  /** Sends the member to CHIP to pay a month and save a card. */
  checkout: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'checkout');
      try {
        return { url: await checkout(context.locals.billing, member, absolute(context, '/')) };
      } catch (error) {
        await report('payment', `CHIP could not open a payment page for ${member.email}`, error);
        throw new ActionError({ code: 'BAD_GATEWAY', message: 'The payment page did not open. Try again in a minute.' });
      }
    },
  }),

  setRenews: defineAction({
    accept: 'form',
    input: z.object({ renews: z.enum(['true', 'false']) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return { renews: (await context.locals.billing.setRenews(member.id, input.renews === 'true')).renews };
    },
  }),
};
