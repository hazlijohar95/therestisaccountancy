import { createFileRoute } from '@tanstack/react-router';
import { calendarFile } from '../../../../../src/server/calendar.ts';
import { callEvent } from '../../../../../src/server/calls.ts';
import { membersPaid } from '../../../functions/members-gate.ts';
import { currentMember } from '../../../lib/session.server.ts';
import { withStore } from '../../../lib/store.server.ts';

/** The calendar file for a member's own call. Nobody else's: the link in it is for them. */
export const Route = createFileRoute('/members/calls/{$id}.ics')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const member = await currentMember();
        if (!member) return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(new URL(request.url).pathname)}`, request.url), 302);
        if (!(await membersPaid())) return new Response(null, { status: 302, headers: { location: '/members/pay' } });
        const call = await withStore(async (store) => store.calls.booking(member.id));
        if (!call || String(call.id) !== params.id) return new Response('You have no call booked at that time.', { status: 404 });
        return new Response(calendarFile(callEvent(call, 'member')), {
          headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="call-${call.id}.ics"` },
        });
      },
    },
  },
});
