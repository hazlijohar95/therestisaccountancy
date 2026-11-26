import { createFileRoute } from '@tanstack/react-router';
import { calendarFile } from '../../../../../src/server/calendar.ts';
import { callEvent } from '../../../../../src/server/calls.ts';
import { admit, toClub } from '../../../lib/access.server.ts';
import { withStore } from '../../../lib/store.server.ts';

/** The calendar file for a member's own call. Nobody else's: the link in it is for them. */
export const Route = createFileRoute('/members/calls/{$id}.ics')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const member = await admit('paid', toClub);
        const call = await withStore(async (store) => store.calls.booking(member.id));
        if (!call || String(call.id) !== params.id) return new Response('You have no call booked at that time.', { status: 404 });
        return new Response(calendarFile(callEvent(call, 'member')), {
          headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="call-${call.id}.ics"` },
        });
      },
    },
  },
});
