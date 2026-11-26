import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import type { Outcome } from '../../lib/outcome.ts';

type Refused<R> = Extract<R, { readonly ok: false }>;

/**
 * Runs a Social server function from a button or form, in place: busy while it runs, the refusal if there is one, and
 * every loader on the page refreshed after a success, so counts and states redraw without a page load.
 */
export function useAction<I, R extends Outcome<unknown>>(fn: (options: { data: I }) => Promise<R>, { refresh = true }: { refresh?: boolean } = {}) {
  const call = useServerFn(fn);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refused<R> | null>(null);

  /** The outcome, once the page has redrawn with it. A second press while one runs is ignored, so it answers null. */
  const run = async (data: I): Promise<R | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      const outcome = await call({ data });
      setRefusal(outcome.ok ? null : (outcome as Refused<R>));
      if (outcome.ok && refresh) await router.invalidate();
      return outcome;
    } finally {
      setBusy(false);
    }
  };

  return { run, busy, refusal, clear: () => setRefusal(null) };
}

/** A field's error from a refusal, with the attributes its input needs: the error's element id, and any hint's. */
export function fieldError(refusal: { readonly fields: Readonly<Record<string, string>> } | null, field: string, { id = `${field}-error`, hint }: { id?: string; hint?: string } = {}) {
  const error = refusal?.fields[field];
  return { error, errorId: id, invalid: error ? true : undefined, describedBy: [hint, error ? id : undefined].filter(Boolean).join(' ') || undefined };
}
