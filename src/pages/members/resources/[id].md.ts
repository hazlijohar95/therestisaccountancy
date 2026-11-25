import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';

export const prerender = false;

/** A template as its Markdown file, note to the member included, for members who keep their own copies. */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.member) return new Response(null, { status: 401 });
  const resource = await getEntry('resources', params.id ?? '');
  if (!resource) return new Response('No template by that name.', { status: 404 });
  return new Response(resource.body ?? '', {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${resource.id}.md"` },
  });
};
