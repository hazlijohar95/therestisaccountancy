import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { TERMS } from '../../../src/data/membership.ts';
import type { Standing } from '../../../src/server/billing.ts';
import type { CheckoutRefusal } from '../../../src/server/charges.ts';
import { checkout as openCheckout, settle } from '../../../src/server/payments.ts';
import { report } from '../../../src/server/report.ts';
import { memberOrRefusal, memberOrSignIn } from '../lib/guards.server.ts';
import { allowed, tooManyTries } from '../lib/limits.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

/** A standing as plain data, off the store's reply, for the page. */
export const plainStanding = ({ access, paidUntil, term, cardOnFile, renews }: Standing): Standing => ({ access, paidUntil, term, cardOnFile, renews });

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
    const member = await memberOrSignIn();
    if (member.role === 'admin') throw redirect({ href: '/members' });
    const standing = await withStore(async (store) => {
      if (back === 'paid') {
        for (const open of await store.billing.unpaid(member.id, 'checkout')) {
          await settle(store.billing, open).catch((error: unknown) => report('payment', `Payment ${open} could not be checked with CHIP on return`, error));
        }
      }
      return plainStanding(await store.billing.standing(member.id));
    });
    if (back === 'paid' && standing.access === 'paid') throw redirect({ href: '/members?paid' });
    return { member: { name: member.name, email: member.email, clubApproved: member.clubApproved }, standing };
  });

const checkoutInput = z.object({ term: z.enum(TERMS) });

/** Opens CHIP's payment page for the term the member chose, saving a card where CHIP can. Answers where to send them. */
export const checkout = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof checkoutInput>) => input)
  .handler(async ({ data }): Promise<Outcome<{ url: string }>> => {
    const input = parsed(checkoutInput, data);
    if (!input.ok) return input;
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    if (!(await allowed('checkout'))) return refused(tooManyTries);
    try {
      const opened = await withStore((store) => openCheckout(store.billing, member.value, input.value.term, absolute('/')));
      return opened.ok ? done({ url: opened.value }) : refused(checkoutRefusals[opened.reason]);
    } catch (error) {
      await report('payment', `CHIP could not open a payment page for ${member.value.email}`, error);
      return refused('The payment page did not open. Try again in a minute.');
    }
  });

const renewsInput = z.object({ renews: z.boolean() });

export const setRenews = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof renewsInput>) => input)
  .handler(async ({ data }): Promise<Outcome<{ renews: boolean }>> => {
    const input = parsed(renewsInput, data);
    if (!input.ok) return input;
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const standing = await withStore(async (store) => store.billing.setRenews(member.value.id, input.value.renews));
    return done({ renews: standing.renews });
  });
