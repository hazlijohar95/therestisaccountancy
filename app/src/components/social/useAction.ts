import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import type { Outcome } from '../../lib/outcome.ts';

export type Refusal = Extract<Outcome<never>, { ok: false }>;

/**
 * Runs a Social form's server function in place. While it runs the form is busy; a refusal is kept to show, and its
 * first invalid field takes focus; a success refreshes the page's data without a reload, unless the caller navigates.
 */
export function useAction<I, T>(fn: (options: { data: I }) => Promise<Outcome<T>>, { refresh = true } = {}) {
  const router = useRouter();
  const call = useServerFn(fn);
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  useEffect(() => {
    if (refusal) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusal]);

  const run = async (data: I): Promise<Outcome<T>> => {
    setBusy(true);
    try {
      const outcome = await call({ data });
      if (outcome.ok && refresh) await router.invalidate();
      setRefusal(outcome.ok ? null : outcome);
      return outcome;
    } finally {
      setBusy(false);
    }
  };

  /** The refusal's message for one field, if it named that field. */
  const error = (field: string): string | undefined => refusal?.fields[field];

  return { form, busy, refusal, run, error, clear: () => setRefusal(null) };
}

/** The ids a field's description is made of, joined, or nothing when there are none. */
export const describedBy = (...ids: readonly (string | false | null | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;
