import type { IncidentKind } from './incidents.ts';
import { openStore } from './instance.ts';

/** Logs a failure and keeps it for the admins' daily summary. Never throws: reporting must not break what it reports on. */
export async function report(kind: IncidentKind, what: string, error?: unknown): Promise<void> {
  const detail = error === undefined ? what : `${what}: ${error instanceof Error ? error.message : String(error)}`;
  console.error(`[${kind}] ${detail}`);
  try {
    const store = await openStore();
    try {
      await store.incidents.record(kind, detail);
    } finally {
      store[Symbol.dispose]();
    }
  } catch (failure) {
    console.error('Could not record the failure', failure);
  }
}
