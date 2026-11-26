/** A form field's text, or '' when the form has no such field. */
export const formText = (form: FormData, name: string) => String(form.get(name) ?? '');
