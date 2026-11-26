/** A form field's text, or '' when the form has no such field. */
export const formText = (form: FormData, name: string) => String(form.get(name) ?? '');

/** The ids a field's description is made of, joined in order, or nothing when there are none. */
export const describedBy = (...ids: readonly (string | false | null | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

/** An input tied to its error: the message, if there is one, the id of the element that shows it, and the input's attributes. */
export interface Field {
  readonly error: string | undefined;
  readonly errorId: string;
  /** Spread on the input: invalid while it has an error, and described by its hint, then its error. */
  readonly input: { readonly 'aria-invalid': true | undefined; readonly 'aria-describedby': string | undefined };
}

/** Wires an input to error, shown in the element with id. hint is the id of text that describes the input whatever its state. */
export function wireField(error: string | null | undefined, { id, hint }: { id: string; hint?: string | undefined }): Field {
  const message = error || undefined;
  return { error: message, errorId: id, input: { 'aria-invalid': message ? true : undefined, 'aria-describedby': describedBy(hint, message && id) } };
}
