import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { TERMS } from '../../../src/data/membership.ts';
import type { CheckoutRefusal } from '../../../src/server/charges.ts';
import { checkout as openCheckout, settle } from '../../../src/server/payments.ts';
import { report } from '../../../src/server/report.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

const checkoutRefusals: Record<CheckoutRefusal, string> = {
  'not-approved': 'Club membership needs an accepted request first. Ask to join and we reply by email.',
};

/**
 * The pay page. Admins never pay. Back from CHIP, its callback may not have landed yet, so CHIP is asked directly
 * about every payment page the member opened, since they may have paid any of them.
 */
export const membersPay = createServerFn({ method: 'GET' })
  .validator((back: 'paid' | 'failed' | undefined) => back)
  .handler(async ({ data: back }) => {
    const member = await admit('member', toClub);
    if (member.role === 'admin') throw redirect({ href: '/members' });
    const standing = await withStore(async (store) => {
      if (back === 'paid') {
        for (const open of await store.billing.unpaid(member.id, 'checkout')) {
          await settle(store.billing, open).catch((error: unknown) => report('payment', `Payment ${open} could not be checked with CHIP on return`, error));
        }
      }
      return store.billing.standing(member.id);
    });
    if (back === 'paid' && standing.access === 'paid') throw redirect({ href: '/members?paid' });
    return { member: { name: member.name, email: member.email, clubApproved: member.clubApproved }, standing };
  });

const checkoutInput = z.object({ term: z.enum(TERMS) });

/** Opens CHIP's payment page for the term the member chose, saving a card where CHIP can. Answers where to send them. */
export const checkout = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof checkoutInput>) => input)
  .handler(
    action({ access: 'member', input: checkoutInput, limit: 'checkout', refusals: checkoutRefusals }, async ({ actor, input, store }) => {
      try {
        const opened = await openCheckout(store.billing, actor, input.term, absolute('/'));
        return opened.ok ? done({ url: opened.value }) : opened;
      } catch (error) {
        await report('payment', `CHIP could not open a payment page for ${actor.email}`, error);
        return refused('The payment page did not open. Try again in a minute.');
      }
    }),
  );

const renewsInput = z.object({ renews: z.boolean() });

export const setRenews = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof renewsInput>) => input)
  .handler(
    action({ access: 'member', input: renewsInput }, async ({ actor, input, store }) => {
      const standing = await store.billing.setRenews(actor.id, input.renews);
      return done({ renews: standing.renews });
    }),
  );
