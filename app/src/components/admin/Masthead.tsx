import type { ReactNode } from 'react';
import s from './Masthead.module.css';

/** The night band that opens every admin page: a ruled label, a serif headline, and an optional lead. */
export function Masthead({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return (
    <section className="night">
      <div className={`wrap ${s.masthead}`}>
        <p className={`label ${s.top}`}>{label}</p>
        <h1 className={`headline serif ${s.headline}`}>{title}</h1>
        {children && <div className={s.lead}>{children}</div>}
      </div>
    </section>
  );
}
