import { openStore } from './instance.ts';
import { LISTS, type List } from './mailings.ts';

/** The members' optional emails, and the free newsletter, which keeps its own list of addresses. */
type Stoppable = List | 'newsletter';
const isStoppable = (value: string | null): value is Stoppable => value === 'newsletter' || LISTS.some((list) => list === value);

/**
 * A POST to /unsubscribe: either a mail app's one-click request (RFC 8058) or the button on the unsubscribe page.
 * Answered in the Worker before Astro (see worker.ts). The key in the link is the only authority it needs.
 */
export async function unsubscribe(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get('k') ?? '';
  const list = url.searchParams.get('list');
  if (!key || !isStoppable(list)) return new Response('That link is not complete. Open the unsubscribe link in the latest email again, or reply to that email and ask us to stop.', { status: 400 });
  const store = await openStore();
  try {
    if (list === 'newsletter') await store.newsletter.unsubscribe(key);
    else await store.mailings.unsubscribe(key, list);
  } finally {
    store[Symbol.dispose]();
  }
  const form = await request.formData().catch(() => null);
  if (form?.get('from') === 'page') return Response.redirect(new URL(`/unsubscribe?list=${list}&done`, url).href, 303);
  return new Response('Unsubscribed.');
}
