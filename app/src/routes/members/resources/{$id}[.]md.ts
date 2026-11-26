import { createFileRoute } from '@tanstack/react-router';
import { resourceById } from '../../../lib/content.server.ts';
import { admit, toClub } from '../../../lib/access.server.ts';

/** A template as its Markdown file, note to the member included, for members who keep their own copies. */
export const Route = createFileRoute('/members/resources/{$id}.md')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        await admit('paid', toClub);
        const resource = resourceById(params.id);
        if (!resource) return new Response('No template by that name.', { status: 404 });
        return new Response(resource.body, {
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${resource.id}.md"` },
        });
      },
    },
  },
});
