import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import s from './Steps.module.css';

export type StepState = 'done' | 'current' | 'todo';

export interface Step {
  readonly label: string;
  readonly detail?: ReactNode;
  /** Leave out on every step for a plain numbered sequence: how something works, not where someone is in it. */
  readonly state?: StepState;
  /** Where to go to do the step. Not linked once it is done. */
  readonly href?: string;
}

/** Numbered steps joined by a track. With states, done steps are ticked and the current one is marked for assistive tech. */
export function Steps({ items, label }: { items: readonly Step[]; label?: string }) {
  return (
    <ol className={s.steps} aria-label={label}>
      {items.map((step, i) => (
        <li key={step.label} className={s.step} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span className={s.marker} aria-hidden="true">
            {step.state === 'done' ? <Icon name="check" size={18} /> : i + 1}
          </span>
          <div className={s.text}>
            <h3 className={s.label}>
              {step.href && step.state !== 'done' ? <a href={step.href}>{step.label}</a> : step.label}
              {step.state === 'done' && <span className="visually-hidden"> (done)</span>}
            </h3>
            {step.detail && <div className={`small ${s.detail}`}>{step.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** How far through something someone is: a bar and a count. */
export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div className={s.progress}>
      <div className={`small ${s.top}`}>
        <span>{label}</span>
        <b>
          {value} of {max}
        </b>
      </div>
      <div className={s.bar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} style={{ '--share': share }} />
    </div>
  );
}
