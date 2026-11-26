import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';

/* Every change comes from a page on the same host. CHIP and mail apps post to routes the Worker answers first. */
const csrf = createCsrfMiddleware({ filter: ({ request }) => request.method !== 'GET' && request.method !== 'HEAD' });

/** The most any form may send: a 5 MB document and the rest of the form. Refused before the body is read. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const bodyLimit = createMiddleware().server(({ request, next }) =>
  Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES ? new Response('Upload a file under 5 MB.', { status: 413 }) : next(),
);

export const startInstance = createStart(() => ({ requestMiddleware: [csrf, bodyLimit] }));
