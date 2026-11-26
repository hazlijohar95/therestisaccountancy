import { trackNames, type Track } from '../../../../src/data/social.ts';

/** Where someone stands in the profession, beside their name. */
export function Flair({ track }: { track: Track }) {
  return (
    <span className="flair" data-track={track}>
      {trackNames[track]}
    </span>
  );
}
