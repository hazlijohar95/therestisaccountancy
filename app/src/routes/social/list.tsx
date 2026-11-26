import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { TOPICS, TRACKS, trackNames, type Topic, type Track } from '../../../../src/data/social.ts';
import { Avatar } from '../../components/social/Avatar.tsx';
import { Flair } from '../../components/social/Flair.tsx';
import { listPage } from '../../functions/social-profiles.ts';
import { socialTitle } from '../../lib/title.ts';

const NOMINATED = { yes: 'Nominated. Private until they claim it.', already: 'You nominated them already.' } as const;

export const Route = createFileRoute('/social/list')({
  validateSearch: z.object({
    topic: z.enum(TOPICS).optional().catch(undefined),
    track: z.enum(TRACKS).optional().catch(undefined),
    nominated: z.enum(['yes', 'already']).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ topic: search.topic ?? null, track: search.track ?? null }),
  loader: ({ deps }) => listPage({ data: deps }),
  staticData: { section: 'list' },
  head: () => ({ meta: socialTitle('The List') }),
  component: List,
});

function List() {
  const { entries, nominated, filtered } = Route.useLoaderData();
  const { topic, track, nominated: outcome } = Route.useSearch();
  /** The List with one filter changed and the other kept. */
  const filter = (change: { topic?: Topic | undefined; track?: Track | undefined }) => ({ topic, track, ...change });
  const topicChips = [{ label: 'All', topic: undefined }, ...TOPICS.map((t) => ({ label: t, topic: t }))];
  const trackChips = [{ label: 'Everyone', track: undefined }, ...TRACKS.map((t) => ({ label: trackNames[t], track: t }))];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="kicker">The List</p>
          <h1 className="title">People worth following.</h1>
          <p className="lead">Ranked by peers who rated their answers. Never by followers.</p>
        </div>
        <Link className="btn" to="/social/nominate">
          <svg aria-hidden="true">
            <use href="#i-plus" />
          </svg>
          Nominate someone
        </Link>
      </div>
      {outcome && (
        <p className="note" role="status">
          {NOMINATED[outcome]}
        </p>
      )}
      <div className="list-tools">
        <nav className="chips" aria-label="Topic">
          {topicChips.map((chip) => (
            <Link key={chip.label} className="chip" to="/social/list" search={filter({ topic: chip.topic })} aria-current={chip.topic === topic ? 'page' : undefined}>
              {chip.label}
            </Link>
          ))}
        </nav>
        <nav className="chips" aria-label="Track">
          {trackChips.map((chip) => (
            <Link key={chip.label} className="chip" to="/social/list" search={filter({ track: chip.track })} aria-current={chip.track === track ? 'page' : undefined}>
              {chip.label}
            </Link>
          ))}
        </nav>
      </div>
      {entries.length + nominated.length ? (
        <ol className="list card">
          {entries.map(({ profile, points }, i) => (
            <li key={profile.handle}>
              <Link className="row" to="/social/@{$handle}" params={{ handle: profile.handle }}>
                <span className="no" aria-hidden="true">
                  {i + 1}
                </span>
                <Avatar name={profile.name} track={profile.track} sealed={profile.sealed} />
                <span className="who">
                  <b className="name-line">
                    {profile.name}
                    {profile.sealed && (
                      <svg className="seal" role="img" aria-label="Ticked">
                        <use href="#seal" />
                      </svg>
                    )}
                  </b>
                  <span className="meta">
                    <Flair track={profile.track} />
                    {profile.jurisdictions.map((j) => (
                      <span key={j} className="jur">
                        {j}
                      </span>
                    ))}
                  </span>
                  {profile.headline && <span className="meta headline">{profile.headline}</span>}
                </span>
                <span className="score">
                  <b>{points}</b>
                  <small>Peer points</small>
                </span>
                <span className="go" aria-hidden="true">
                  <svg>
                    <use href="#i-arrow" />
                  </svg>
                </span>
              </Link>
            </li>
          ))}
          {nominated.map((n) => (
            <li key={`n${n.id}`}>
              <div className="row unclaimed">
                <span className="no" aria-hidden="true">
                  ·
                </span>
                <span className="avatar" data-track="field" aria-hidden="true">
                  @
                </span>
                <span className="who">
                  <b>@{n.handle}</b>
                  <span className="meta">
                    <span className="flair" data-track="field">
                      Unclaimed
                    </span>
                    <span className="tag">{n.platform}</span>
                    {n.topics.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </span>
                  <span className="meta headline">{n.state === 'invited' ? 'Invited. Only you can see this until they claim it.' : 'Only you can see this. Public once they claim it.'}</span>
                </span>
                <span className="score">
                  <small>{n.state === 'invited' ? 'Invited' : 'Nominated'}</small>
                </span>
                <span className="go" aria-hidden="true">
                  <svg>
                    <use href="#i-lock" />
                  </svg>
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="card empty">
          <p className="head">{filtered ? 'No one matches yet.' : 'No one is on The List yet.'}</p>
          <p>{filtered ? 'Try another topic or track.' : 'It fills with real people as they join. Know someone who posts things worth learning from?'}</p>
          {filtered ? (
            <Link className="btn sm ghost" to="/social/list">
              Show everyone
            </Link>
          ) : (
            <Link className="btn sm" to="/social/nominate">
              Nominate them
            </Link>
          )}
        </div>
      )}
      <p className="rank-note">
        <svg aria-hidden="true">
          <use href="#i-up" />
        </svg>
        Peer points: answers rated sound by ticked members, plus saves on shared work, this quarter. Points start when Problems opens.
      </p>
    </div>
  );
}
