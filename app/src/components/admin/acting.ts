import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import type { Outcome } from '../../lib/outcome.ts';

/**
 * Runs one admin action at a time from a page: the buttons stay disabled while it runs, and once it is done the page's
 * data is read again, so the lists show what changed whatever the answer.
 */
export function useActing() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const act = async <T>(work: () => Promise<Outcome<T>>): Promise<Outcome<T>> => {
    setBusy(true);
    try {
      const outcome = await work();
      await router.invalidate();
      return outcome;
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}
