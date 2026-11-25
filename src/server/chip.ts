import { z } from 'astro/zod';

/** CHIP Collect, the payment gateway. Amounts are in sen. Docs: https://docs.chip-in.asia/chip-collect */
const BASE = 'https://gate.chip-in.asia/api/v1';

export interface ChipConfig {
  readonly secretKey: string;
  readonly brandId: string;
}

const purchaseShape = z.object({
  id: z.string(),
  status: z.string(),
  checkout_url: z.string().nullish(),
  is_recurring_token: z.boolean().nullish(),
  reference: z.string().nullish(),
  /** What is left to refund, in sen. Zero once refunded in full. */
  refundable_amount: z.number().nullish(),
});
export type Purchase = z.infer<typeof purchaseShape>;

/** A charge CHIP refused, with its reason code. An invalid token means the saved card cannot be used again. */
export class ChipRefusal extends Error {
  readonly status: number;
  readonly codes: readonly string[];
  constructor(status: number, codes: readonly string[]) {
    super(`CHIP refused the request (${status}): ${codes.join(', ') || 'no reason given'}`);
    this.status = status;
    this.codes = codes;
  }
  get cardRefused() {
    return this.codes.includes('invalid_recurring_token');
  }
}

const refusalCodes = (body: unknown): string[] => {
  const all = z.object({ __all__: z.array(z.object({ code: z.string() })) }).safeParse(body);
  return all.success ? all.data.__all__.map((e) => e.code) : [];
};

export function chip(config: ChipConfig, fetcher: typeof fetch = fetch) {
  const call = async (path: string, init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' }): Promise<unknown> => {
    const response = await fetcher(`${BASE}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${config.secretKey}`, 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ChipRefusal(response.status, refusalCodes(body));
    return body;
  };

  return {
    /**
     * A purchase for one month. Given methods to save with, the payer must use one of them and CHIP keeps it for
     * renewals, charged later with charge(). Without, CHIP offers every method the brand accepts and keeps nothing.
     */
    async purchase(input: { email: string; name: string; product: string; amount: number; reference: string; saveWith?: readonly string[]; callback: string; back?: { paid: string; failed: string } }): Promise<Purchase> {
      return purchaseShape.parse(
        await call('/purchases/', {
          method: 'POST',
          body: {
            brand_id: config.brandId,
            reference: input.reference,
            client: { email: input.email, full_name: input.name },
            purchase: { currency: 'MYR', products: [{ name: input.product, price: input.amount }] },
            send_receipt: true,
            success_callback: input.callback,
            ...(input.saveWith?.length ? { force_recurring: true, payment_method_whitelist: input.saveWith } : {}),
            ...(input.back ? { success_redirect: input.back.paid, failure_redirect: input.back.failed, cancel_redirect: input.back.failed } : {}),
          },
        }),
      );
    },

    /** The methods the brand accepts that CHIP can charge again later (cards, when enabled). FPX is never one. */
    async savableMethods(amount: number): Promise<string[]> {
      const query = new URLSearchParams({ brand_id: config.brandId, currency: 'MYR', amount: String(amount), recurring: 'true' });
      return z.object({ available_payment_methods: z.array(z.string()) }).parse(await call(`/payment_methods/?${query}`)).available_payment_methods;
    },

    /** Charges a purchase to the card saved by an earlier checkout. */
    async charge(purchaseId: string, token: string): Promise<Purchase> {
      return purchaseShape.parse(await call(`/purchases/${encodeURIComponent(purchaseId)}/charge/`, { method: 'POST', body: { recurring_token: token } }));
    },

    async get(purchaseId: string): Promise<Purchase> {
      return purchaseShape.parse(await call(`/purchases/${encodeURIComponent(purchaseId)}/`));
    },

    /** Stops CHIP keeping the card. Used when a member turns renewal off. */
    async forgetCard(token: string): Promise<void> {
      await call(`/purchases/${encodeURIComponent(token)}/delete_recurring_token/`, { method: 'POST' });
    },

    /** The key CHIP signs purchase callbacks with, as PEM. */
    async publicKey(): Promise<string> {
      return z.string().parse(await call('/public_key/'));
    },
  };
}

export type Chip = ReturnType<typeof chip>;

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

/** True when the X-Signature header is CHIP's RSA SHA-256 signature of exactly these bytes. */
export async function signedByChip(body: ArrayBuffer, signature: string, publicKeyPem: string): Promise<boolean> {
  try {
    const der = fromBase64(publicKeyPem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, ''));
    const key = await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64(signature), body);
  } catch {
    return false;
  }
}

/** A paid purchase undone: refunded in full, or charged back. A partial refund leaves the month in place. */
export const isReversed = (purchase: Purchase) => purchase.status === 'chargeback' || (purchase.status === 'refunded' && purchase.refundable_amount === 0);

/** A purchase CHIP reports as paid. Anything else (pending, failed, refunded) does not extend a membership. */
export const isPaid = (purchase: Purchase) => purchase.status === 'paid';
