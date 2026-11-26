import { channelBySlug, threadPath } from '../../../../src/data/community.ts';
import { formatMoment } from '../../../../src/lib/format.ts';
import type { Thread } from '../../../../src/server/community.ts';
import s from './ThreadList.module.css';

const replies = (n: number) => (n === 0 ? 'No replies yet' : n === 1 ? '1 reply' : `${n} replies`);

export function ThreadList({ threads, showChannel = false }: { threads: readonly Thread[]; showChannel?: boolean }) {
  return (
    <ol className={s.threads} role="list">
      {threads.map((t) => (
        <li key={t.id}>
          <a className={s.title} href={threadPath(t.id)}>
            {t.title}
          </a>
          <p className={`small ${s.meta}`}>
            {[t.pinned ? 'Pinned' : null, t.locked ? 'Locked' : null, showChannel ? channelBySlug(t.channel)?.name : null, t.author?.name ?? 'Former member', replies(t.replies), `Active ${formatMoment(t.lastPostAt)}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </li>
      ))}
    </ol>
  );
}
