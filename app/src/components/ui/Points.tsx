import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import s from './Points.module.css';

/** Short facts, each behind an icon, in place of a paragraph that lists them. */
export function Points({ items }: { items: readonly { icon: IconName; text: ReactNode }[] }) {
  return (
    <ul className={s.points}>
      {items.map((item, i) => (
        <li key={i}>
          <Icon name={item.icon} />
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
