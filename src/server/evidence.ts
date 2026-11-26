import { env } from 'cloudflare:workers';
import { CLAIM_LIMITS } from '../data/social.ts';
import { fail, ok, type Result } from './result.ts';
import { evidenceType } from './social-claims.ts';

/*
 * The documents members upload for the team, in the EVIDENCE bucket. Each is stored before its claim is saved, read
 * only by the team, and deleted once the claim is decided.
 */

const EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export type EvidenceRefusal = 'evidence-type' | 'evidence-size';

/** Stores a member's upload under a fresh key, with the type its bytes say it is. */
export async function storeEvidence(memberId: number, file: File): Promise<Result<string, EvidenceRefusal>> {
  if (file.size === 0 || file.size > CLAIM_LIMITS.evidenceBytes) return fail('evidence-size');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = evidenceType(bytes.subarray(0, 16));
  if (!type) return fail('evidence-type');
  const key = `claims/${memberId}/${crypto.randomUUID()}`;
  await env.EVIDENCE.put(key, bytes, { httpMetadata: { contentType: type } });
  return ok(key);
}

export const deleteEvidence = (key: string) => env.EVIDENCE.delete(key);

/** Deletes every document a member ever uploaded, for when the member is removed and their claims go with them. */
export async function deleteMemberEvidence(memberId: number): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.EVIDENCE.list({ prefix: `claims/${memberId}/`, ...(cursor ? { cursor } : {}) });
    if (page.objects.length) await env.EVIDENCE.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/**
 * The document as a download for the team. It is never shown inline on the site's own address, and the browser is
 * told not to guess its type, so a file cannot run as a page.
 */
export async function evidenceDownload(key: string, filename: string): Promise<Response | null> {
  const object = await env.EVIDENCE.get(key);
  if (!object) return null;
  const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const extension = EXTENSIONS.get(type) ?? 'bin';
  return new Response(object.body, {
    headers: {
      'content-type': type,
      'content-length': String(object.size),
      'content-disposition': `attachment; filename="${filename}.${extension}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
