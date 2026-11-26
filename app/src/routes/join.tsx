import { createFileRoute } from '@tanstack/react-router';
import { join } from '../functions/public-forms.server.ts';

/* The join page itself is static. Its form posts here, and a plain post answers with a 303 to /join/request. */
export const Route = createFileRoute('/join')({
  server: { handlers: { POST: ({ request }) => join(request) } },
});
