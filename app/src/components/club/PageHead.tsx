import type { ReactNode } from 'react';
import s from './PageHead.module.css';

/** The dark band that opens a club page: a label, the page's title, a lead and any actions. */
export function PageHead({ label, title, lead, children }: { label: string; title: string; lead?: string | undefined; children?: ReactNode }) {
  return (
    <section className="night" aria-labelledby="page-title">
      <div className={`wrap ${s.in}`}>
        <p className={`label ${s.top}`}>{label}</p>
        <h1 className={`headline serif ${s.headline}`} id="page-title">
          {title}
        </h1>
        {lead && <p className={s.lead}>{lead}</p>}
        {children && <div className={s.actions}>{children}</div>}
      </div>
    </section>
  );
}
