import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { TERMS } from '../data/membership.ts';
import { checkout } from '../server/payments.ts';
import { report } from '../server/report.ts';
import type { CheckoutRefusal } from '../server/charges.ts';
import { absolute, settle, signedIn, throttle, type Refusal } from './guards.ts';

const checkoutRefusals: Record<CheckoutRefusal, Refusal> = {
  'not-approved': { code: 'FORBIDDEN', message: 'Club membership needs an accepted request first. Ask to join and we reply by email.' },
};

export const billing = {
  /** Sends the member to CHIP to pay for the term they chose, and save a card where CHIP can. */
  checkout: defineAction({
    accept: 'form',
    input: z.object({ term: z.enum(TERMS) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'checkout');
      const opened = await checkout(context.locals.billing, member, input.term, absolute(context, '/')).catch(async (error: unknown) => {
        await report('payment', `CHIP could not open a payment page for ${member.email}`, error);
        throw new ActionError({ code: 'BAD_GATEWAY', message: 'The payment page did not open. Try again in a minute.' });
      });
      return { url: settle(opened, checkoutRefusals) };
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
