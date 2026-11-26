/*
 * The router reads each query value as JSON where it can, so ?q=2024 arrives as a number and ?q=x as a string. These
 * read a value back as what the page wants, and drop anything else rather than refuse the page.
 */

/** A query value as text. */
export const textParam = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined);

/** A query value as a whole number above zero. */
export const countParam = (value: unknown) => {
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
