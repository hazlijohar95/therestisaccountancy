import type { Track } from '../../../../src/data/social.ts';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word][0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** A member's initials, coloured by their track, with the seal when they hold it. Decorative: the name is said beside it. */
export function Avatar({ name, track, sealed = false, size }: { name: string; track?: Track | undefined; sealed?: boolean; size?: 'sm' | 'lg' | undefined }) {
  return (
    <span className={size ? `avatar ${size}` : 'avatar'} data-track={track} aria-hidden="true">
      {initialsOf(name)}
      {sealed && (
        <svg className="seal">
          <use href="#seal" />
        </svg>
      )}
    </span>
  );
}
