import type { z } from 'zod';

/**
 * What a form's server function answers. A refusal carries the message to show, and the fields it is about, so the
 * form can show each error beside its field.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly fields: Readonly<Record<string, string>> };

export const done = <T>(value: T): Outcome<T> => ({ ok: true, value });
export const refused = (message: string, fields: Readonly<Record<string, string>> = {}): Outcome<never> => ({ ok: false, message, fields });

/** Parses form input with the schema, or the refusal naming each field's first problem. */
export function parsed<S extends z.ZodType>(schema: S, input: unknown): { readonly ok: true; readonly value: z.output<S> } | Outcome<never> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !(field in fields)) fields[field] = issue.message;
  }
  return refused('Check the fields marked below.', fields);
}
