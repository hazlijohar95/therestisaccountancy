/** The longest search the dialog sends. Longer text is cut, never refused. */
export const SEARCH_MAX = 60;

export interface Matcher {
  /** A LIKE pattern, with ESCAPE '\', that every match also fits. SQL narrows with it; test() decides. */
  readonly like: string;
  /** True when a word in the text starts with the query, in any case: "lea" finds "Leases", not "release". */
  test(text: string): boolean;
}

/** A word-start matcher for what someone typed. Null when there is nothing to search for. */
export function matcher(query: string): Matcher | null {
  const typed = query.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX);
  if (!typed) return null;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${typed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');
  return { like: `%${typed.replace(/[\\%_]/g, '\\$&')}%`, test: (text) => pattern.test(text) };
}
