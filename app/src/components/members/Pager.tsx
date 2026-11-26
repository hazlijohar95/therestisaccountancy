import { useLocation } from '@tanstack/react-router';
import s from './Pager.module.css';

/** Previous and next for a list in pages. Each link keeps the rest of the page's query. */
export function Pager({ page, pages, label }: { page: number; pages: number; label: string }) {
  const location = useLocation();
  if (pages <= 1) return null;
  const href = (to: number) => {
    const search = new URLSearchParams(location.searchStr);
    if (to <= 1) search.delete('page');
    else search.set('page', String(to));
    const rest = search.toString();
    return rest ? `${location.pathname}?${rest}` : location.pathname;
  };
  return (
    <nav className={s.pager} aria-label={label}>
      {page > 1 ? (
        <a href={href(page - 1)} rel="prev">
          Previous
        </a>
      ) : (
        <span />
      )}
      <span className="small">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <a href={href(page + 1)} rel="next">
          Next
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}
