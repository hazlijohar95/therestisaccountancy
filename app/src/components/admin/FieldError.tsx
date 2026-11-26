/** The field errors a refused form came back with, by field name. */
export type Fields = Readonly<Record<string, string>>;

/** The attributes that tie a field to the error beside it, when it has one. */
export const describedBy = (errors: Fields, name: string, id = name) => (errors[name] ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {});

/** A field's error, beside it. className adds the page's own look to the brand's .field .error. */
export function FieldError({ errors, name, id = name, className = '' }: { errors: Fields; name: string; id?: string; className?: string | undefined }) {
  const message = errors[name];
  return message ? (
    <span className={`error ${className}`} id={`${id}-error`}>
      {message}
    </span>
  ) : null;
}
