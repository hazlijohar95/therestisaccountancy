import { createFileRoute, notFound } from '@tanstack/react-router';

/* Any other path under /members is not found inside its own section, never taken for a post at /$column/$slug. */
export const Route = createFileRoute('/members/$')({
  beforeLoad: () => {
    throw notFound();
  },
});
