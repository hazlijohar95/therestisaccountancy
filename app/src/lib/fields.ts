import { z } from 'zod';
import { joinSection } from '../../../src/data/club.ts';

/* Field rules the server functions share. Their messages are the Astro actions' word for word. */

/** Text on one line: runs of whitespace, line breaks included, become one space. Names go into email subjects. */
export const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

export const email = z.string().trim().toLowerCase().pipe(z.email(joinSection.messages.email));
export const memberName = z.string().transform(oneLine).pipe(z.string().min(1, 'Enter a name.').max(60, 'Keep the name under 60 characters.'));

/** A record's id, as a number or as the text a form field holds. */
export const id = z.coerce.number().int().positive();
/** A record's id that the page sends back as a number. Text is refused. */
export const numberId = z.number().int().positive();

/** A link's token or a handle: some text. What it names is the store's call. */
export const token = z.string().min(1);

/** A text field that may be left blank: a missing value reads as ''. */
export const blankable = <T extends z.ZodType>(schema: T) => z.preprocess((value) => value ?? '', schema);

/** One required line, at most max characters. */
export const line = (max: number, empty: string) =>
  z
    .string(empty)
    .transform(oneLine)
    .pipe(z.string().min(1, empty).max(max, `Keep it under ${max} characters.`));

/** Malaysia keeps UTC+8 all year, so a local date and time map to one instant. Null for a date or time that does not exist. */
export const malaysiaTime = (date: string, time: string): string | null => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d || hh > 23 || mm > 59) return null;
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm)).toISOString().replace(/\.\d{3}Z$/, 'Z');
};
