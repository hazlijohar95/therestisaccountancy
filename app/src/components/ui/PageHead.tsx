import type { ReactNode } from 'react';
import s from './PageHead.module.css';

/**
 * The night band that opens a page: a ruled label, the title, one short line under it, then actions.
 * aside sits beside the title on wide screens: a card, a figure or a stat.
 */
export function PageHead({ label, title, lead, actions, aside }: { label: ReactNode; title: string; lead?: ReactNode; actions?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="night" aria-labelledby="page-title">
      <div className={`wrap ${s.head}${aside ? ` ${s.split}` : ''}`}>
        <p className={`label ${s.label}`}>{label}</p>
        <div className={s.main}>
          <h1 className={`serif ${s.title}`} id="page-title">
            {title}
          </h1>
          {lead && <p className={`lead ${s.lead}`}>{lead}</p>}
          {actions && <div className={s.actions}>{actions}</div>}
        </div>
        {aside && <div className={s.aside}>{aside}</div>}
      </div>
    </section>
  );
}
