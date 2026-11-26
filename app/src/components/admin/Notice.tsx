import type { ReactNode } from 'react';
import s from './Notice.module.css';

/** What an admin's last action did, or why it did not. */
export interface Said {
  readonly tone: 'ok' | 'error';
  readonly text: ReactNode;
}

/** A one-line outcome under the masthead: what just happened, or why it did not. */
export function Notice({ tone = 'ok', children }: { tone?: Said['tone']; children: ReactNode }) {
  return (
    <p className={`wrap ${s.notice} ${tone === 'error' ? s.error : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

/** The notice for the last thing said, if anything. */
export const Told = ({ said }: { said: Said | null }) => (said ? <Notice tone={said.tone}>{said.text}</Notice> : null);
