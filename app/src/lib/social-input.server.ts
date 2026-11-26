import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { joinSection } from '../../../src/data/club.ts';
import { socialUrl } from '../../../src/server/paths.ts';

/*
 * The input pieces Social's server functions share. They repeat src/actions/guards.ts, which imports astro:actions and
 * so cannot be imported here.
 */

/** A line of text: runs of whitespace, line breaks included, become one space. */
export const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/** A text field that may be left blank. */
export const blankable = <T extends z.ZodType>(schema: T) => z.preprocess((value) => value ?? '', schema);

export const id = z.coerce.number().int().positive();
export const email = z.string().trim().toLowerCase().pipe(z.email(joinSection.messages.email));

/** One required line, at most max characters. */
export const line = (max: number, empty: string) =>
  z
    .string(empty)
    .transform(oneLine)
    .pipe(z.string().min(1, empty).max(max, `Keep it under ${max} characters.`));

/** A date and time typed in Malaysian time, as an instant. Null when the date does not exist. */
export const malaysiaTime = (date: string, time: string): string | null => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d || hh > 23 || mm > 59) return null;
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm)).toISOString().replace(/\.\d{3}Z$/, 'Z');
};

/** A full address for a Social page, for links that leave in an email. Never built on the request's Host. */
export const socialAbsolute = (path: string) => socialUrl(env.SITE_URL, path);

/** A posted form's text fields and files, by name, for a zod schema. A file input left empty posts an empty file. */
export function formFields(form: FormData, names: readonly string[]): Record<string, string | File | undefined> {
  return Object.fromEntries(names.map((name) => [name, form.get(name) ?? undefined]));
}
