import type { ReactNode } from 'react';
import s from './Card.module.css';

/** A framed choice or object: an offer, a plan, a booking. tag rides the top edge; foot holds its action. featured sets it on night. */
export function Card({ tag, foot, featured = false, children }: { tag?: string | null | undefined; foot?: ReactNode; featured?: boolean; children: ReactNode }) {
  return (
    <article className={`${s.card}${featured ? ` night ${s.featured}` : ''}`}>
      {tag && <span className={`label ${s.tag}`}>{tag}</span>}
      <div className={s.body}>{children}</div>
      {foot && <div className={s.foot}>{foot}</div>}
    </article>
  );
}

/** Cards side by side, wrapping on narrow screens. */
export function Cards({ children }: { children: ReactNode }) {
  return <div className={s.cards}>{children}</div>;
}
