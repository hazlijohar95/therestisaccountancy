import type { ReactNode } from 'react';
import s from './Pager.module.css';

/** Previous and next through a long list. link draws the anchor to another page, so each list keeps its own query. */
export function Pager({ page, pages, label, link }: { page: number; pages: number; label: string; link: (page: number, rel: 'prev' | 'next', text: string) => ReactNode }) {
  if (pages <= 1) return null;
  return (
    <nav className={s.pager} aria-label={label}>
      {page > 1 ? link(page - 1, 'prev', 'Previous') : <span />}
      <span className="small">
        Page {page} of {pages}
      </span>
      {page < pages ? link(page + 1, 'next', 'Next') : <span />}
    </nav>
  );
}
