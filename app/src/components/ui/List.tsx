import type { ReactNode } from 'react';
import { dayParts } from '../../../../src/lib/format.ts';
import { Icon, type IconName } from './Icon.tsx';
import s from './List.module.css';

/** Ruled rows, top to bottom. ordered when the order means something: a schedule, a ranking. */
export function List({ ordered = false, children }: { ordered?: boolean; children: ReactNode }) {
  const Tag = ordered ? 'ol' : 'ul';
  return <Tag className={s.list}>{children}</Tag>;
}

/**
 * One row: lead on the left (a date, a number, an icon), the title with meta under it, trail on the right
 * (a badge, a count, an action). children run under the meta.
 */
export function Row({ lead, title, meta, trail, children }: { lead?: ReactNode; title: ReactNode; meta?: ReactNode; trail?: ReactNode; children?: ReactNode }) {
  return (
    <li className={`${s.row}${lead ? ` ${s.led}` : ''}`}>
      {lead && <div className={s.lead}>{lead}</div>}
      <div className={s.body}>
        <h3 className={s.title}>{title}</h3>
        {meta && <div className={`small ${s.meta}`}>{meta}</div>}
        {children}
      </div>
      {trail && <div className={s.trail}>{trail}</div>}
    </li>
  );
}

/** A day as a tile: the date large, the month and weekday small, in Malaysian time. */
export function DateTile({ at }: { at: string }) {
  const { day, month, weekday } = dayParts(at);
  return (
    <time className={s.date} dateTime={at}>
      <span className="label">{weekday}</span>
      <b className="serif">{day}</b>
      <span className="label">{month}</span>
    </time>
  );
}

/** One fact in a row's meta, behind a small icon: a time, a count, a place. */
export function Meta({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className={s.fact}>
      <Icon name={icon} size={16} />
      {children}
    </span>
  );
}
