import type { Term } from '../../../../src/data/club.ts';
import s from './Steps.module.css';

/** Numbered steps in columns, as many across as there are steps, up to the width. */
export function Steps({ items }: { items: readonly Term[] }) {
  return (
    <ol className={s.steps} style={{ '--n': items.length }}>
      {items.map(({ term, detail }) => (
        <li key={term}>
          <h3 className="head">{term}</h3>
          <p>{detail}</p>
        </li>
      ))}
    </ol>
  );
}
