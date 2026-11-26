import { createCsrfMiddleware, createStart } from '@tanstack/react-start';

/* Every change comes from a page on the same host. CHIP and mail apps post to routes the Worker answers first. */
const csrf = createCsrfMiddleware({ filter: ({ request }) => request.method !== 'GET' && request.method !== 'HEAD' });

export const startInstance = createStart(() => ({ requestMiddleware: [csrf] }));
