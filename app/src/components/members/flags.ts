/**
 * A route's search for notices: each name present in the address, with or without a value, as ?saved or ?saved=1
 * reads, is true. Emailed links and redirects use the bare form.
 */
export const flags =
  <F extends string>(...names: readonly F[]) =>
  (search: Record<string, unknown>): Partial<Record<F, true>> => {
    const present: Partial<Record<F, true>> = {};
    for (const name of names) if (search[name] !== undefined) present[name] = true;
    return present;
  };

/** The ?page= of a list, when it is a number. Anything else reads as the first page. */
export const pageIn = (search: Record<string, unknown>): { page?: number } => (typeof search['page'] === 'number' ? { page: search['page'] } : {});
