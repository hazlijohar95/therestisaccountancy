import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { env } from 'cloudflare:workers';
import { isReversed, signedByChip } from '../../server/chip.ts';
import { club } from '../../server/payments.ts';
import { report } from '../../server/report.ts';

export const prerender = false;

const event = z.object({ event_type: z.string(), related_to: z.object({ type: z.string(), id: z.string() }).nullish() });

/**
 * CHIP's webhook for refunds and chargebacks. The body is the refund or chargeback Payment, pointing at the purchase it
 * undoes. The signature proves CHIP sent it, and the purchase is read back from CHIP before a month is taken off.
 * The account's purchases include other businesses', which are not the club's and change nothing here.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.arrayBuffer();
  if (!(await signedByChip(body, request.headers.get('x-signature') ?? '', env.CHIP_WEBHOOK_KEY))) return new Response('Bad signature', { status: 401 });
  const parsed = event.safeParse(JSON.parse(new TextDecoder().decode(body)));
  const purchaseId = parsed.success && parsed.data.related_to?.type === 'purchase' ? parsed.data.related_to.id : null;
  if (!purchaseId) return new Response('ok');
  try {
    const purchase = await club().get(purchaseId);
    if (!isReversed(purchase)) return new Response('ok');
    const undone = await locals.billing.reversed(purchase.id);
    if (undone) await report('payment', `Payment ${purchase.id} was ${purchase.status === 'chargeback' ? 'charged back' : 'refunded'}; a month came off member ${undone.memberId}'s paid time`);
  } catch (error) {
    await report('payment', `Refund or chargeback for ${purchaseId} could not be checked with CHIP; CHIP will call again`, error);
    return new Response('Try again', { status: 503 });
  }
  return new Response('ok');
};
