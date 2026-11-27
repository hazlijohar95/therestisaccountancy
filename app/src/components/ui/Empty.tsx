import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import s from './Empty.module.css';

/** Nothing here yet: an icon, one line, and what to do about it if there is something. */
export function Empty({ icon = 'info', children, action }: { icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <span className={s.icon}>
        <Icon name={icon} size={24} />
      </span>
      <p>{children}</p>
      {action}
    </div>
  );
}
