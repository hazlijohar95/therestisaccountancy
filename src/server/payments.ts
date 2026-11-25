import { env } from 'cloudflare:workers';
import { MONTHLY_PRICE_SEN } from '../data/membership.ts';
import { site } from '../data/site.ts';
import type { Renewal } from './billing.ts';
import { chip, ChipRefusal, isPaid, type Chip } from './chip.ts';
import type { Store } from './instance.ts';

const PRODUCT = `${site.name} membership, one month`;

/** CHIP with the club's keys. Test keys take test cards; live keys take real money. */
export const club = (): Chip => chip({ secretKey: env.CHIP_SECRET_KEY, brandId: env.CHIP_BRAND_ID });

/** CHIP's signing key, fetched once per Worker instance. */
let signingKey: Promise<string> | null = null;
export const chipSigningKey = () => (signingKey ??= club().publicKey().catch((error: unknown) => {
  signingKey = null;
  throw error;
}));

/** Opens CHIP's payment page for a member's first month (or a month with a new card). Returns where to send them. */
export async function checkout(billing: Store['billing'], member: { id: number; email: string; name: string }, siteUrl: string): Promise<string> {
  const url = (path: string) => new URL(path, siteUrl).href;
  const purchase = await club().purchase({
    email: member.email,
    name: member.name,
    product: PRODUCT,
    amount: MONTHLY_PRICE_SEN,
    reference: `member-${member.id}`,
    saveCard: true,
    callback: url('/chip/callback'),
    back: { paid: url('/members/pay?back=paid'), failed: url('/members/pay?back=failed') },
  });
  if (!purchase.checkout_url) throw new Error(`CHIP gave no payment page for purchase ${purchase.id}`);
  await billing.opened(purchase.id, member.id, 'checkout', MONTHLY_PRICE_SEN);
  return purchase.checkout_url;
}

/** Asks CHIP for a purchase's state and records it if paid. Callbacks and returns from the payment page both land here. */
export async function settle(billing: Store['billing'], purchaseId: string) {
  const purchase = await club().get(purchaseId);
  return isPaid(purchase) ? billing.paid(purchase.id, purchase.is_recurring_token === true) : null;
}

export type RenewalOutcome = 'paid' | 'pending' | 'declined' | 'card-refused';

/** Charges one month to a member's saved card. */
export async function renew(billing: Store['billing'], renewal: Renewal, siteUrl: string): Promise<RenewalOutcome> {
  /* A previous attempt CHIP may have charged after all (a timeout, a lost callback): count it instead of charging again. */
  const earlier = await billing.unpaid(renewal.memberId, 'renewal');
  if (earlier && (await settle(billing, earlier))) return 'paid';
  const gateway = club();
  const purchase = await gateway.purchase({
    email: renewal.email,
    name: renewal.name,
    product: PRODUCT,
    amount: MONTHLY_PRICE_SEN,
    reference: `member-${renewal.memberId}-renewal`,
    saveCard: false,
    callback: new URL('/chip/callback', siteUrl).href,
  });
  await billing.opened(purchase.id, renewal.memberId, 'renewal', MONTHLY_PRICE_SEN);
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
