import type { APIRoute } from 'astro';
import { evidenceDownload } from '../../../../server/evidence.ts';

export const prerender = false;

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

/** A claim's document, for the team only. Anyone else, and any claim already decided, gets a plain 404. */
export const GET: APIRoute = async ({ params, locals }) => {
  if (locals.member?.role !== 'admin') return notFound();
  const claimId = Number(params.claim);
  if (!Number.isSafeInteger(claimId) || claimId <= 0) return notFound();
  const key = await locals.socialClaims.evidenceKey(claimId);
  return (key && (await evidenceDownload(key, `claim-${claimId}`))) || notFound();
};
