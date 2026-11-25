import { openStore } from './instance.ts';
import { LISTS, type List } from './mailings.ts';

const isList = (value: string | null): value is List => LISTS.some((list) => list === value);

/**
 * A POST to /unsubscribe: either a mail app's one-click request (RFC 8058) or the button on the unsubscribe page. It
 * is answered here, before Astro, because mail apps post it from their own servers with no Origin header, which
 * Astro's cross-site check would refuse. The key in the link is the only authority it needs.
 */
export async function unsubscribe(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get('k') ?? '';
  const list = url.searchParams.get('list');
  if (!key || !isList(list)) return new Response('That link is not complete.', { status: 400 });
  const store = await openStore();
  try {
    await store.mailings.unsubscribe(key, list);
  } finally {
    store[Symbol.dispose]();
  }
  const form = await request.formData().catch(() => null);
  if (form?.get('from') === 'page') return Response.redirect(new URL(`/unsubscribe?list=${list}&done`, url).href, 303);
  return new Response('Unsubscribed.');
}
