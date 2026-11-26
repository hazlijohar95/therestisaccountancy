import type { Field } from '../lib/form.ts';

/** A field's error, beside it, when it has one. className adds the page's own look to the brand's .error. */
export function FieldError({ field, className }: { field: Field; className?: string | undefined }) {
  return field.error ? (
    <span className={className ? `error ${className}` : 'error'} id={field.errorId}>
      {field.error}
    </span>
  ) : null;
}
