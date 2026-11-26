import { createFileRoute } from '@tanstack/react-router';
import { channelBySlug, channelPath } from '../../../../../src/data/community.ts';
import { formatMoment } from '../../../../../src/lib/format.ts';
import { Masthead } from '../../../components/club/Masthead.tsx';
import { Notice } from '../../../components/club/Notice.tsx';
import { ThreadList } from '../../../components/members/ThreadList.tsx';
import { membersCommunity } from '../../../functions/members-community.ts';
import { flags } from '../../../components/members/flags.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './index.module.css';

export const Route = createFileRoute('/members/community/')({
  validateSearch: flags('gone'),
  loader: () => membersCommunity(),
  head: () => ({ meta: clubTitle('Community') }),
  component: Community,
});

const count = (n: number) => (n === 1 ? '1 thread' : `${n} threads`);

function Community() {
  const { summaries, recent } = Route.useLoaderData();
  const { gone } = Route.useSearch();
  return (
    <>
      <Masthead label="Community" title="Ask the room." narrow>
        <p>Members only. Be specific about your numbers, generous with what worked, and keep client names out of it.</p>
      </Masthead>

      {gone && <Notice tone="error">That thread was removed, so your change could not be made.</Notice>}

      <section className={`wrap ${s.block}`} aria-labelledby="channels-title">
        <h2 className="head" id="channels-title">
          Channels
        </h2>
        <ul className={s.channels} role="list">
          {summaries.map(({ slug, threads, latest }) => (
            <li key={slug}>
              <a className={s.name} href={channelPath(slug)}>
                {channelBySlug(slug)?.name}
              </a>
              <p className={s.about}>{channelBySlug(slug)?.about}</p>
              <p className={`small ${s.meta}`}>{threads === 0 ? 'Nothing yet. Start the first thread.' : `${count(threads)} · latest: ${latest?.title ?? ''}, ${latest ? formatMoment(latest.lastPostAt) : ''}`}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="recent-title">
        <h2 className="head" id="recent-title">
          Recent
        </h2>
        {recent.length === 0 ? <p className={s.empty}>No threads yet. Pick a channel and start one.</p> : <ThreadList threads={recent} showChannel />}
      </section>
    </>
  );
}
