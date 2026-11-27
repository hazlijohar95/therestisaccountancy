import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { Field as Wired } from '../../lib/form.ts';
import { FieldError } from '../FieldError.tsx';
import s from './Form.module.css';

/** A form laid out as one column: fields, then its outcome, then the button, left-aligned. */
export function Form({ className, ...props }: ComponentPropsWithoutRef<'form'>) {
  return <form method="POST" {...props} className={className ? `${s.form} ${className}` : s.form} />;
}

/** A labelled input: the label, the input, a hint, and its error when it has one. */
export function Field({ label, id, hint, field, children }: { label: string; id: string; hint?: ReactNode; field?: Wired; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {field && <FieldError field={field} />}
    </div>
  );
}

/** A checkbox or radio with its label, and a hint under the label. */
export function Check({ label, hint, type = 'checkbox', ...input }: Omit<ComponentPropsWithoutRef<'input'>, 'type'> & { label: ReactNode; hint?: ReactNode; type?: 'checkbox' | 'radio' }) {
  return (
    <label className={s.check}>
      <input type={type} {...input} />
      <span>
        {hint ? <b>{label}</b> : label}
        {hint && <span className="hint">{hint}</span>}
      </span>
    </label>
  );
}

/** Choices under one question, as checks. */
export function Choices({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={s.choices}>
      <legend className="label">{legend}</legend>
      {children}
    </fieldset>
  );
}
