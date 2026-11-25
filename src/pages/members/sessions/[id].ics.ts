import type { APIRoute } from 'astro';
import { calendarFile, sessionEvent } from '../../../server/calendar.ts';

export const prerender = false;

/** A session's calendar file, for members who want it in their calendar without waiting for the email. */
export const GET: APIRoute = async ({ params, locals, site, url }) => {
  if (!locals.member) return new Response(null, { status: 401 });
  const id = Number(params.id);
  const session = Number.isInteger(id) ? await locals.schedule.session(id, locals.member.id) : null;
  if (!session) return new Response('That session is over or was called off.', { status: 404 });
  return new Response(calendarFile(sessionEvent(session, (site ?? url).hostname)), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="session-${session.id}.ics"` },
  });
};
