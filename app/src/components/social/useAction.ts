import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import type { Outcome } from '../../lib/outcome.ts';

type Refused<R> = Extract<R, { readonly ok: false }>;

const isRefused = <R extends Outcome<unknown>>(outcome: R): outcome is Refused<R> => !outcome.ok;

/**
 * Runs a Social server function from a button or form, in place: busy while it runs, the refusal if there is one, and
 * every loader on the page refreshed after a success, so counts and states redraw without a page load. A form that
 * takes the form ref has its first invalid field focused when a refusal comes back.
 */
export function useAction<I, R extends Outcome<unknown>>(fn: (options: { data: I }) => Promise<R>, { refresh = true }: { refresh?: boolean } = {}) {
  const call = useServerFn(fn);
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refused<R> | null>(null);

  useEffect(() => {
    if (refusal) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusal]);

  /** The outcome, once the page has redrawn with it. A second press while one runs is ignored, so it answers null. */
  const run = async (data: I): Promise<R | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      const outcome = await call({ data });
      setRefusal(isRefused(outcome) ? outcome : null);
      if (outcome.ok && refresh) await router.invalidate();
      return outcome;
    } finally {
      setBusy(false);
    }
  };

  /** The refusal's message for one field, if it named that field. */
  const error = (field: string): string | undefined => refusal?.fields[field];

  /** A refusal not about any one field, to show above the form's button. Field refusals show beside their fields. */
  const failure = refusal && Object.keys(refusal.fields).length === 0 ? refusal.message : null;

  return { form, run, busy, refusal, failure, error, clear: () => setRefusal(null) };
}

/** The ids a field's description is made of, joined, or nothing when there are none. */
export const describedBy = (...ids: readonly (string | false | null | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

/** A field's error from a refusal, with the attributes its input needs: the error's element id, and any hint's. */
export function fieldError(refusal: { readonly fields: Readonly<Record<string, string>> } | null, field: string, { id = `${field}-error`, hint }: { id?: string; hint?: string } = {}) {
  const error = refusal?.fields[field];
  return { error, errorId: id, invalid: error ? true : undefined, describedBy: describedBy(hint, error && id) };
}
