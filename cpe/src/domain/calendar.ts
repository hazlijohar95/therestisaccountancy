/*
 * Calendar days in Malaysia. MIA's CPE year is the Malaysian calendar year, so every date that decides which year
 * credit falls in is taken in Malaysian time, never sliced from a UTC timestamp.
 */

/** A calendar day in Malaysia, "YYYY-MM-DD". */
export type MytDate = string & { readonly __brand: "MytDate" };

/** Malaysia has kept UTC+8, with no daylight saving, since 1982. */
const OFFSET_MS = 8 * 3_600_000;

/** The Malaysian calendar day an instant falls on. */
export const mytDate = (at: Date): MytDate => new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10) as MytDate;

/** A "YYYY-MM-DD" string that names a real day, or null. */
export function parseMytDate(text: string): MytDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const day = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text ? null : (text as MytDate);
}

export const yearOf = (date: MytDate): number => Number(date.slice(0, 4));

/** "1 January 2027" or "1 Jan 2027", the same wherever the reader is. */
export const formatDay = (date: MytDate, month: "long" | "short" = "long"): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month, year: "numeric", timeZone: "UTC" });

/** Whole days from `today` to 31 December of its year, the day MIA's portal closes for that year. */
export const daysToYearEnd = (today: MytDate): number => Math.round((Date.UTC(yearOf(today), 11, 31) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
