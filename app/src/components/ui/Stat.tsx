import type { ReactNode } from 'react';
import s from './Stat.module.css';

export interface StatItem {
  readonly value: ReactNode;
  readonly label: string;
  readonly note?: ReactNode;
}

/** A figure with its label under it: the number does the talking. */
export function Stat({ value, label, note }: StatItem) {
  return (
    <div className={s.stat}>
      <span className={`serif ${s.value}`}>{value}</span>
      <span className={`label ${s.label}`}>{label}</span>
      {note && <span className={`small ${s.note}`}>{note}</span>}
    </div>
  );
}

/** Figures side by side in ruled cells. */
export function Stats({ items }: { items: readonly StatItem[] }) {
  return (
    <dl className={`cells ${s.stats}`}>
      {items.map((item) => (
        <div key={item.label} className={s.cell}>
          <dt className={`label ${s.label}`}>{item.label}</dt>
          <dd className={`serif ${s.value}`}>{item.value}</dd>
          {item.note && <dd className={`small ${s.note}`}>{item.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
