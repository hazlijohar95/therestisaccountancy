import type { ReactNode } from 'react';
import s from './Table.module.css';

/** A ledger table that scrolls sideways on its own when it is wider than the page. Pass thead and tbody. */
export function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.scroll} role="region" aria-label={label} tabIndex={0}>
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
