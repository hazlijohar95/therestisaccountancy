import type { ReactNode } from 'react';
import s from './Section.module.css';

/** A numbered section: the rail with its number, title and intro, then the body. Ruled from the section before. */
export function Section({ id, no, title, intro, rail, children }: { id: string; no: number; title: string; intro?: string | undefined; rail?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec wrap" id={id} aria-labelledby={`${id}-title`}>
      <div className={`${s.rail} reveal`}>
        <span className={`${s.no} serif`}>N°{no}</span>
        <h2 className={`head ${s.head}`} id={`${id}-title`}>
          {title}
        </h2>
        {intro && <p className={s.intro}>{intro}</p>}
        {rail}
      </div>
      <div className="reveal">{children}</div>
    </section>
  );
}
