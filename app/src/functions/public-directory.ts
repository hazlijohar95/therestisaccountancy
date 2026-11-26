import { createServerFn } from '@tanstack/react-start';
import { isServiceSlug, isState, type ServiceSlug, type State } from '../../../src/data/directory.ts';
import { directorySummary, type Directory } from '../../../src/server/listings.ts';
import { withStore } from '../lib/store.server.ts';

/** The public directory, filtered by state and service. A value the lists do not hold is ignored, not an error. */
export const directoryPage = createServerFn({ method: 'GET' })
  .validator((input: { state: string; service: string }) => input)
  .handler(async ({ data }): Promise<Directory & { summary: string; state: State | null; service: ServiceSlug | null }> => {
    const state = isState(data.state) ? data.state : undefined;
    const service = isServiceSlug(data.service) ? data.service : undefined;
    const found = await withStore(async (store) => await store.listings.directory({ state, service }));
    return { total: found.total, matches: found.matches, anywhere: found.anywhere, summary: directorySummary(found, { state, service }), state: state ?? null, service: service ?? null };
  });
