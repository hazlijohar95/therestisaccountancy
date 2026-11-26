/*
 * The router reads each search value as JSON where it can, so ?k=123 arrives as a number and ?done as ''. Links in
 * emails carry these values; read them back as the text they were sent as.
 */
export const textParam = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '');
