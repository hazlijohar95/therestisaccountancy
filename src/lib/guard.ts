/*
 * What in free text could point at a client, and why. Casebook notes and role titles are public, and a figure, a
 * company suffix, a place, a listing, a date or a superlative is often enough to name the client. The browser warns as
 * people type; the server refuses the same text.
 */
export const GUARDS = [
  { id: 'figures', pattern: /\bRM\s?\d|\d+(\.\d+)?\s?(m|mil|million|bn|billion|k)\b/i, message: 'Figures narrow it down. Use the size band.' },
  { id: 'company', pattern: /\b(sdn\.?\s?bhd|berhad|bhd|plt|pte\.?\s?ltd|ltd|inc)\b/i, message: 'Looks like a company name.' },
  { id: 'place', pattern: /\b(kuala lumpur|kl|penang|sabah|sarawak|johor|selangor|melaka|ipoh|kedah|perak|pahang|singapore|klang)\b/i, message: 'Place names narrow it down.' },
  { id: 'listing', pattern: /\b(listed|bursa|ace market|main market|ipo)\b/i, message: 'Listing status narrows it down.' },
  { id: 'date', pattern: /\b(19|20)\d{2}\b/, message: 'Dates narrow it down. The year is set above.' },
  { id: 'unique', pattern: /\b(only|biggest|largest|first|sole)\b/i, message: '“Only” and “largest” point at one client.' },
] as const;
export type GuardId = (typeof GUARDS)[number]['id'];

/** Why this text could point at a client: one message per kind of clue, in a fixed order. Empty when it cannot. */
export const identifying = (text: string, skip: readonly GuardId[] = []): string[] =>
  GUARDS.filter((guard) => !skip.includes(guard.id) && guard.pattern.test(text)).map((guard) => guard.message);

/** A role's title says what someone did. "First" and "sole" are fair there: "first-year associate", "sole practitioner". */
export const ROLE_TITLE_SKIP: readonly GuardId[] = ['unique'];
