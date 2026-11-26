import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { describedBy, wireField } from '../lib/form.ts';
import { failure, type Outcome } from '../lib/outcome.ts';

type Refused<R> = Extract<R, { readonly ok: false }>;

const isRefused = <R extends Outcome<unknown>>(outcome: R): outcome is Refused<R> => !outcome.ok;

/**
 * When the page's loaders run again after an answer. 'success' redraws what a success changed. 'always' also redraws
 * after a refusal, for pages where a refusal can mean the data moved on (someone else decided it first). 'never' is
 * for a form that shows its own answer, or that leaves the page.
 */
export type Refresh = 'success' | 'always' | 'never';

/**
 * Runs a form's server function from a button or form, in place: busy while it runs, the refusal if there is one, and
 * the page's loaders run again as refresh says. A form that takes the form ref has its first invalid field focused
 * when a refusal comes back.
 */
export function useAction<I, R extends Outcome<unknown>>(fn: (options: { data: I }) => Promise<R>, { refresh = 'success' }: { refresh?: Refresh } = {}) {
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
      if (refresh === 'always' || (refresh === 'success' && outcome.ok)) await router.invalidate();
      return outcome;
    } finally {
      setBusy(false);
    }
  };

  /** The refusal's message for one field, if it named that field. */
  const error = (name: string): string | undefined => refusal?.fields[name];

  /** One field wired to the refusal. Its error shows in the element with id, `${name}-error` unless given. */
  const field = (name: string, { id = `${name}-error`, hint }: { id?: string; hint?: string } = {}) => wireField(refusal?.fields[name], { id, hint });

  return { form, run, busy, refusal, failure: failure(refusal), error, field, clear: () => setRefusal(null) };
}

/** A field's error from a refusal, with the attributes its input needs: the error's element id, and any hint's. */
export function fieldError(refusal: { readonly fields: Readonly<Record<string, string>> } | null, field: string, { id = `${field}-error`, hint }: { id?: string; hint?: string } = {}) {
  const error = refusal?.fields[field];
  return { error, errorId: id, invalid: error ? true : undefined, describedBy: describedBy(hint, error && id) };
}
