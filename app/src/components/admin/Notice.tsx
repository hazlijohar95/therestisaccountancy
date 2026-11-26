import type { ReactNode } from 'react';
import s from './Notice.module.css';

/** A one-line outcome under the masthead: what just happened, or why it did not. */
export function Notice({ tone = 'ok', children }: { tone?: 'ok' | 'error'; children: ReactNode }) {
  return (
    <p className={`wrap ${s.notice} ${tone === 'error' ? s.error : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
