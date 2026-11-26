import type { APIRoute } from 'astro';
import { identify, isIdentityRequest } from '../../server/cpe-identity.ts';

export const prerender = false;

/** Answers the CPE binding only. The middleware has already resolved the member from the forwarded cookie. */
export const GET: APIRoute = async ({ request, locals }) => {
  if (!isIdentityRequest(request)) return new Response('Not found', { status: 404 });
  return Response.json(await identify(locals.member, (memberId) => locals.billing.access(memberId)));
};
