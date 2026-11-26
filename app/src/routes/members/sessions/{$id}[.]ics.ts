import { createFileRoute } from '@tanstack/react-router';
import { calendarFile, sessionEvent } from '../../../../../src/server/calendar.ts';
import { admit, toClub } from '../../../lib/access.server.ts';
import { withStore } from '../../../lib/store.server.ts';

/** A session's calendar file, for members who want it in their calendar without waiting for the email. */
export const Route = createFileRoute('/members/sessions/{$id}.ics')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const member = await admit('paid', toClub);
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
