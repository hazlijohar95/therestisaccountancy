import { markUseful, unmarkUseful } from '../../functions/social-floor.ts';
import { useSay } from './Notice.tsx';
import { useAction } from './useAction.ts';

/** The useful mark on a post or reply. A button for a signed-in reader who did not write it; a count for everyone else. */
export function UsefulButton({ target, id, useful, pressed, canMark }: { target: 'post' | 'reply'; id: number; useful: number; pressed: boolean; canMark: boolean }) {
  const mark = useAction(markUseful);
  const unmark = useAction(unmarkUseful);
  const say = useSay();
  if (!canMark)
    return (
      <span className="act">
        <svg aria-hidden="true">
          <use href="#i-up" />
        </svg>
        {useful} useful
      </span>
    );
  const toggle = async () => {
    const action = pressed ? unmark : mark;
    const outcome = await action.run({ target, id });
    if (outcome) say(outcome.ok ? { tone: 'quiet', text: pressed ? 'Unmarked.' : 'Marked useful.' } : { tone: 'error', text: outcome.message });
  };
  return (
    <button className="act" type="button" id={`useful-${target}-${id}`} aria-pressed={pressed} onClick={toggle}>
      <svg aria-hidden="true">
        <use href="#i-up" />
      </svg>
      {useful} useful
    </button>
  );
}
