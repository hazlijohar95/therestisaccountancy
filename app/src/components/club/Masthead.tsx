import type { ReactNode } from 'react';
import s from './Masthead.module.css';

/** The night band that opens every members' and admin page: a ruled label, a serif headline, and an optional lead. */
export function Masthead({ label, title, narrow = false, children }: { label: ReactNode; title: string; narrow?: boolean; children?: ReactNode }) {
  return (
    <section className="night">
      <div className={`wrap ${s.masthead}`}>
        <p className={`label ${s.top}`}>{label}</p>
        <h1 className={`headline serif ${s.headline}${narrow ? ` ${s.narrow}` : ''}`}>{title}</h1>
        {children && <div className={`lead ${s.lead}`}>{children}</div>}
      </div>
    </section>
  );
}
