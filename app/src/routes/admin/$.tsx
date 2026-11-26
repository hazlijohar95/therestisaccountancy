import { createFileRoute, notFound } from '@tanstack/react-router';

/* Any other path under /admin is not found inside its own section, never taken for a post at /$column/$slug. */
export const Route = createFileRoute('/admin/$')({
  beforeLoad: () => {
    throw notFound();
  },
});
