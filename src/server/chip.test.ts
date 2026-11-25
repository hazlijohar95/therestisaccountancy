import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chip, ChipRefusal, signedByChip } from './chip.ts';

test('a callback verifies only with CHIP’s signature over the exact bytes', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki)).replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----`;
  const body = new TextEncoder().encode('{"id":"p1","status":"paid"}');
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, body))));

  assert.equal(await signedByChip(body.buffer, signature, pem), true);
  assert.equal(await signedByChip(new TextEncoder().encode('{"id":"p1","status":"paid" }').buffer, signature, pem), false, 'one changed byte fails');
  assert.equal(await signedByChip(body.buffer, 'not base64!', pem), false);
});

test('a refused charge says whether the saved card is dead', async () => {
  const refusing = (async () => new Response(JSON.stringify({ __all__: [{ message: 'Invalid or inactive recurring token!', code: 'invalid_recurring_token' }] }), { status: 400 })) as typeof fetch;
  const error = await chip({ secretKey: 'k', brandId: 'b' }, refusing).charge('p2', 'p1').catch((e: unknown) => e);
  assert.ok(error instanceof ChipRefusal);
  assert.equal(error.cardRefused, true);
});

test('a checkout with savable methods asks CHIP to keep the card, and sends the member back', async () => {
  let sent: unknown = null;
  const recording = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'p1', status: 'created', checkout_url: 'https://gate.chip-in.asia/p/p1/' }), { status: 201 });
  }) as typeof fetch;
  const purchase = await chip({ secretKey: 'k', brandId: 'brand' }, recording).purchase({
    email: 'aina@firm.com.my', name: 'Aina', product: 'Membership, one month', amount: 9900, reference: 'member-1', saveWith: ['visa', 'mastercard'],
    callback: 'https://better-accountant.com/chip/callback', back: { paid: 'https://x/paid', failed: 'https://x/failed' },
  });
  assert.equal(purchase.checkout_url, 'https://gate.chip-in.asia/p/p1/');
  assert.deepEqual(sent, {
    brand_id: 'brand', reference: 'member-1', client: { email: 'aina@firm.com.my', full_name: 'Aina' },
    purchase: { currency: 'MYR', products: [{ name: 'Membership, one month', price: 9900 }] }, send_receipt: true,
    success_callback: 'https://better-accountant.com/chip/callback', force_recurring: true, payment_method_whitelist: ['visa', 'mastercard'],
    success_redirect: 'https://x/paid', failure_redirect: 'https://x/failed', cancel_redirect: 'https://x/failed',
  });
});
