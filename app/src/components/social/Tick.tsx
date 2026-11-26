import { TICK_SOURCES, type TickSource } from '../../../../src/data/social.ts';

/** Self-declared claims draw as their own dashed tick; pending ones are dimmed; lapsed ones are struck in red. */
export type TickState = 'pending' | 'ticked' | 'rejected' | 'lapsed' | 'self';

/** A claim's tickmark: the glyph says how we know, the state how it stands. */
export function Tick({ source, state, vouches = 0 }: { source: TickSource; state: TickState; vouches?: number }) {
  const { glyph, name } = TICK_SOURCES[source];
  const label = `${name}${state === 'lapsed' ? ', lapsed' : state === 'pending' ? ', waiting' : state === 'rejected' ? ', not ticked' : ''}${vouches ? `, ${vouches} ${vouches === 1 ? 'peer' : 'peers'}` : ''}`;
  return (
    <span className="tick" data-state={state} title={label} role="img" aria-label={label}>
      <svg aria-hidden="true">
        <use href={`#${glyph}`} />
      </svg>
    </span>
  );
}
