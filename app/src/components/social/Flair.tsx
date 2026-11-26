import { trackNames, type Track } from '../../../../src/data/social.ts';

/** Where a member is in the profession. */
export function Flair({ track }: { track: Track }) {
  return (
    <span className="flair" data-track={track}>
      {trackNames[track]}
    </span>
  );
}
