import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import s from './Pager.module.css';

type PageLink = (page: number, rel: 'prev' | 'next', text: string) => ReactNode;

/** Previous and next for a list in pages. Each link keeps the rest of the page's query, unless link draws it. */
export function Pager({ page, pages, label, link }: { page: number; pages: number; label: string; link?: PageLink }) {
  const location = useLocation();
  if (pages <= 1) return null;
  const href = (to: number) => {
    const search = new URLSearchParams(location.searchStr);
    if (to <= 1) search.delete('page');
    else search.set('page', String(to));
    const rest = search.toString();
    return rest ? `${location.pathname}?${rest}` : location.pathname;
  };
  const draw: PageLink =
    link ??
    ((to, rel, text) => (
      <a href={href(to)} rel={rel}>
        {text}
      </a>
    ));
  return (
    <nav className={s.pager} aria-label={label}>
      {page > 1 ? draw(page - 1, 'prev', 'Previous') : <span />}
      <span className="small">
        Page {page} of {pages}
      </span>
      {page < pages ? draw(page + 1, 'next', 'Next') : <span />}
    </nav>
  );
}
