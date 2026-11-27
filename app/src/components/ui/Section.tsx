import { useId, type ReactNode } from 'react';
import s from './Section.module.css';

/** A block of a page under a heading. meta sits at the heading's end: a count, a link, a badge. */
export function Section({ title, id, meta, children }: { title: string; id?: string; meta?: ReactNode; children: ReactNode }) {
  const heading = useId();
  return (
    <section className={`wrap ${s.section}`} id={id} aria-labelledby={heading}>
      <div className={s.top}>
        <h2 className={`head ${s.title}`} id={heading}>
          {title}
        </h2>
        {meta && <div className={`small ${s.meta}`}>{meta}</div>}
      </div>
      {children}
    </section>
  );
}

/** A row of buttons and links. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className={s.actions}>{children}</div>;
}
