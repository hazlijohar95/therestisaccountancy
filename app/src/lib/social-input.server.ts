import { env } from 'cloudflare:workers';
import { socialUrl } from '../../../src/server/paths.ts';

/** A full address for a Social page, for links that leave in an email. Never built on the request's Host. */
export const socialAbsolute = (path: string) => socialUrl(env.SITE_URL, path);

/** A posted form's text fields and files, by name, for a zod schema. A file input left empty posts an empty file. */
export function formFields(form: FormData, names: readonly string[]): Record<string, string | File | undefined> {
  return Object.fromEntries(names.map((name) => [name, form.get(name) ?? undefined]));
}
