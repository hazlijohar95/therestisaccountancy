import type { ReactNode } from 'react';
import s from './Notice.module.css';

/** A one-line outcome under the masthead: what just happened, or why it did not. */
export function Notice({ tone = 'ok', id, children }: { tone?: 'ok' | 'error'; id?: string; children: ReactNode }) {
  return (
    <p className={`wrap ${s.notice}${tone === 'error' ? ` ${s.error}` : ''}`} id={id} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
