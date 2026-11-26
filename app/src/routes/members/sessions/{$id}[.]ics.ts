import { createFileRoute } from '@tanstack/react-router';
import { calendarFile, sessionEvent } from '../../../../../src/server/calendar.ts';
import { membersPaid } from '../../../functions/members-gate.ts';
import { currentMember } from '../../../lib/session.server.ts';
import { withStore } from '../../../lib/store.server.ts';

/** A session's calendar file, for members who want it in their calendar without waiting for the email. */
export const Route = createFileRoute('/members/sessions/{$id}.ics')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const member = await currentMember();
        if (!member) return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(new URL(request.url).pathname)}`, request.url), 302);
        if (!(await membersPaid())) return new Response(null, { status: 302, headers: { location: '/members/pay' } });
        const id = Number(params.id);
        const session = Number.isInteger(id) ? await withStore(async (store) => store.schedule.session(id, member.id)) : null;
        if (!session) return new Response('That session is over or was called off.', { status: 404 });
        return new Response(calendarFile(sessionEvent(session)), {
          headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="session-${session.id}.ics"` },
        });
      },
    },
  },
});
