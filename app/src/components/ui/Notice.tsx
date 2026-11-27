import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import s from './Notice.module.css';

const icons = { ok: 'check', error: 'alert', info: 'info' } as const;

/**
 * One line on what just happened, or why it did not. Under the page head by default; inline inside a form or a
 * section, beside what it is about. Errors are announced at once, the rest politely.
 */
export function Notice({ tone = 'ok', inline = false, id, children }: { tone?: 'ok' | 'error' | 'info'; inline?: boolean; id?: string; children: ReactNode }) {
  const notice = (
    <div className={`${s.notice} ${s[tone]}${inline ? ` ${s.inline}` : ''}`} id={id} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icons[tone]} />
      <p>{children}</p>
    </div>
  );
  return inline ? notice : <div className="wrap">{notice}</div>;
}
