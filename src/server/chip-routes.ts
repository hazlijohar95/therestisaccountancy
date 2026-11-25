import { z } from 'astro/zod';
import { env } from 'cloudflare:workers';
import { isReversed, signedByChip } from './chip.ts';
import { openStore, type Store } from './instance.ts';
import { chipSigningKey, club, settle } from './payments.ts';
import { report } from './report.ts';

/*
 * CHIP's calls to the site. They are answered in the Worker before Astro, because Astro refuses cross-site posts that
 * look like forms and CHIP's requests carry no Origin header. The signature is the authority: anything unsigned is
 * refused, and every purchase is read back from CHIP before it changes a membership.
 */

const json = (body: ArrayBuffer): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
};

const withBilling = async <T>(fn: (billing: Store['billing']) => Promise<T>): Promise<T> => {
  const store = await openStore();
  try {
    return await fn(store.billing);
  } finally {
    store[Symbol.dispose]();
  }
};

/** CHIP calls here when a purchase is paid, and may call again for the same purchase. */
export async function paymentCallback(request: Request): Promise<Response> {
  const body = await request.arrayBuffer();
  if (!(await signedByChip(body, request.headers.get('x-signature') ?? '', await chipSigningKey()))) return new Response('Bad signature', { status: 401 });
  const parsed = z.object({ id: z.string() }).safeParse(json(body));
  if (!parsed.success) return new Response('No purchase id', { status: 400 });
  try {
    await withBilling((billing) => settle(billing, parsed.data.id));
  } catch (error) {
    /* A non-2xx makes CHIP call again later, which is what a failed check needs. */
    await report('payment', `Payment ${parsed.data.id} could not be checked with CHIP; CHIP will call again`, error);
    return new Response('Try again', { status: 503 });
  }
  return new Response('ok');
}

const refundEvent = z.object({ related_to: z.object({ type: z.string(), id: z.string() }).nullish() });

/**
 * CHIP's webhook for refunds and chargebacks. The body is the refund or chargeback Payment, pointing at the purchase it
 * undoes. The account's purchases include other businesses', which are not the club's and change nothing here.
 */
export async function refundWebhook(request: Request): Promise<Response> {
  const body = await request.arrayBuffer();
  if (!(await signedByChip(body, request.headers.get('x-signature') ?? '', env.CHIP_WEBHOOK_KEY))) return new Response('Bad signature', { status: 401 });
  const parsed = refundEvent.safeParse(json(body));
  if (!parsed.success) return new Response('Not a payment event', { status: 400 });
  const purchaseId = parsed.data.related_to?.type === 'purchase' ? parsed.data.related_to.id : null;
  if (!purchaseId) return new Response('ok');
  try {
    const purchase = await club().get(purchaseId);
    if (!isReversed(purchase)) return new Response('ok');
    const undone = await withBilling((billing) => billing.reversed(purchase.id));
    if (undone) await report('payment', `Payment ${purchase.id} was ${purchase.status === 'chargeback' ? 'charged back' : 'refunded'}; a month came off member ${undone.memberId}'s paid time`);
  } catch (error) {
    await report('payment', `Refund or chargeback for ${purchaseId} could not be checked with CHIP; CHIP will call again`, error);
    return new Response('Try again', { status: 503 });
  }
  return new Response('ok');
}
