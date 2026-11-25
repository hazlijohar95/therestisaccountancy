import { terms, type Term } from '../data/membership.ts';
import { site } from '../data/site.ts';
import type { createBilling, Renewal } from './billing.ts';
import { ChipRefusal, isPaid, type Chip } from './chip.ts';

/*
 * How money moves between CHIP and the billing store, with the gateway passed in so the flows run against a fake in
 * tests. payments.ts binds them to the club's CHIP account.
 */

type Billing = ReturnType<typeof createBilling>;
/** The billing store, called directly or across to the Durable Object, where every call returns a promise. */
export type Ledger = { readonly [K in 'opened' | 'paid' | 'failed' | 'unpaid']: (...args: Parameters<Billing[K]>) => ReturnType<Billing[K]> | Promise<ReturnType<Billing[K]>> };
export type Gateway = Pick<Chip, 'purchase' | 'savableMethods' | 'charge' | 'get'>;

/** What CHIP shows on its payment page and its receipt. */
const product = (term: Term) => `${site.name} membership, one ${term}`;

/** Opens CHIP's payment page for a term. Returns where to send the member. */
export async function checkout(gateway: Gateway, billing: Ledger, member: { id: number; email: string; name: string }, term: Term, siteUrl: string): Promise<string> {
  const url = (path: string) => new URL(path, siteUrl).href;
  const amount = terms[term].sen;
  /* Cards, once CHIP enables them on the brand, are saved for automatic renewal. Until then members pay each term. */
  const saveWith = await gateway.savableMethods(amount);
  const purchase = await gateway.purchase({
    email: member.email,
    name: member.name,
    product: product(term),
    amount,
    reference: `member-${member.id}`,
    saveWith,
    callback: url('/chip/callback'),
    back: { paid: url('/members/pay?back=paid'), failed: url('/members/pay?back=failed') },
  });
  if (!purchase.checkout_url) throw new Error(`CHIP gave no payment page for purchase ${purchase.id}`);
  await billing.opened(purchase.id, member.id, 'checkout', term);
  return purchase.checkout_url;
}

/** Asks CHIP for a purchase's state and records it if paid. Callbacks and returns from the payment page both land here. */
export async function settle(gateway: Gateway, billing: Ledger, purchaseId: string) {
  const purchase = await gateway.get(purchaseId);
  return isPaid(purchase) ? billing.paid(purchase.id, purchase.is_recurring_token === true) : null;
}

export type RenewalOutcome = 'paid' | 'pending' | 'declined' | 'card-refused';

/** Charges the subscription's term to a member's saved card. */
export async function renew(gateway: Gateway, billing: Ledger, renewal: Renewal, siteUrl: string): Promise<RenewalOutcome> {
  /* A previous attempt CHIP may have charged after all (a timeout, a lost callback): count it instead of charging again. */
  for (const earlier of await billing.unpaid(renewal.memberId, 'renewal')) {
    if (await settle(gateway, billing, earlier)) return 'paid';
  }
  const purchase = await gateway.purchase({
    email: renewal.email,
    name: renewal.name,
    product: product(renewal.term),
    amount: terms[renewal.term].sen,
    reference: `member-${renewal.memberId}-renewal`,
    callback: new URL('/chip/callback', siteUrl).href,
  });
  await billing.opened(purchase.id, renewal.memberId, 'renewal', renewal.term);
  try {
    const charged = await gateway.charge(purchase.id, renewal.token);
    if (isPaid(charged)) {
      await billing.paid(charged.id, false);
      return 'paid';
    }
    return charged.status === 'pending_charge' ? 'pending' : (await billing.failed(purchase.id, false), 'declined');
  } catch (error) {
    /* Only a 400 is CHIP saying no. Anything else (an outage, a timeout) is unknown: leave it for the next run to check. */
    if (!(error instanceof ChipRefusal) || error.status !== 400) throw error;
    await billing.failed(purchase.id, error.cardRefused);
    return error.cardRefused ? 'card-refused' : 'declined';
  }
}
