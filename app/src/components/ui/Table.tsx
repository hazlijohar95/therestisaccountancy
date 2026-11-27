import type { ReactNode } from 'react';
import s from './Table.module.css';

/**
 * A ledger table that scrolls sideways on its own when it is wider than the page. Pass thead and tbody.
 * Columns after the first are figures, right-aligned; words sets them as text instead: names, emails, statuses.
 */
export function Table({ label, words = false, children }: { label: string; words?: boolean; children: ReactNode }) {
  return (
    <div className={words ? `${s.scroll} ${s.words}` : s.scroll} role="region" aria-label={label} tabIndex={0}>
      <table className="ledger">{children}</table>
    </div>
  );
}

/** Do something that cannot be undone only after a second click: the summary opens the form that does it. */
export function Confirm({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className={s.confirm}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
