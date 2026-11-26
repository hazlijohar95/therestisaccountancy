import { createFileRoute } from '@tanstack/react-router';
import { resourceById } from '../../../lib/content.server.ts';
import { currentMember } from '../../../lib/session.server.ts';
import { membersPaid } from '../../../functions/members-gate.ts';

/** A template as its Markdown file, note to the member included, for members who keep their own copies. */
export const Route = createFileRoute('/members/resources/{$id}.md')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!(await currentMember())) return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(new URL(request.url).pathname)}`, request.url), 302);
        if (!(await membersPaid())) return new Response(null, { status: 302, headers: { location: '/members/pay' } });
        const resource = resourceById(params.id);
        if (!resource) return new Response('No template by that name.', { status: 404 });
        return new Response(resource.body, {
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${resource.id}.md"` },
        });
      },
    },
  },
});
