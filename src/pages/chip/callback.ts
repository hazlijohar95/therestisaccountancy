import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { signedByChip } from '../../server/chip.ts';
import { chipSigningKey, settle } from '../../server/payments.ts';
import { report } from '../../server/report.ts';

export const prerender = false;

/**
 * CHIP calls here when a purchase is paid, and may call again for the same purchase. The signature proves the call
 * came from CHIP; the purchase is then read back from CHIP before anything is recorded, so the body is never trusted.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.arrayBuffer();
  const signature = request.headers.get('x-signature') ?? '';
  if (!(await signedByChip(body, signature, await chipSigningKey()))) return new Response('Bad signature', { status: 401 });
  const parsed = z.object({ id: z.string() }).safeParse(JSON.parse(new TextDecoder().decode(body)));
  if (!parsed.success) return new Response('No purchase id', { status: 400 });
  try {
    await settle(locals.billing, parsed.data.id);
  } catch (error) {
    /* A non-2xx makes CHIP call again later, which is what a failed check needs. */
    await report('payment', `Payment ${parsed.data.id} could not be checked with CHIP; CHIP will call again`, error);
    return new Response('Try again', { status: 503 });
  }
  return new Response('ok');
};
