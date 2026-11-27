import type { ReactNode } from 'react';
import s from './Badge.module.css';

/** A short status: plain for facts, solid for the one that matters, live for something happening now. */
export function Badge({ tone = 'plain', children }: { tone?: 'plain' | 'solid' | 'live'; children: ReactNode }) {
  return <span className={`${s.badge} ${s[tone]}`}>{children}</span>;
}
