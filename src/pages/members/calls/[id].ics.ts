import type { APIRoute } from 'astro';
import { calendarFile } from '../../../server/calendar.ts';
import { callEvent } from '../../../server/calls.ts';

export const prerender = false;

/** The calendar file for a member's own call. Nobody else's: the link in it is for them. */
export const GET: APIRoute = async ({ params, locals, site, url }) => {
  if (!locals.member) return new Response(null, { status: 401 });
  const call = await locals.calls.booking(locals.member.id);
  if (!call || String(call.id) !== params.id) return new Response('You have no call booked at that time.', { status: 404 });
  return new Response(calendarFile(callEvent(call, 'member', (site ?? url).hostname)), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="call-${call.id}.ics"` },
  });
};
