import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { RATINGS } from '../../../../src/data/social.ts';
import { formatMoment, formatMonth, tally } from '../../../../src/lib/format.ts';
import type { Notice } from '../../../../src/server/social-notifications.ts';
import { Avatar } from '../../components/social/Avatar.tsx';
import { Tick } from '../../components/social/Tick.tsx';
import { useAction } from '../../components/social/useAction.ts';
import { decideCosign, openNotifications } from '../../functions/social-notifications.ts';
import { socialHref, socialSignInHref } from '../../lib/links.ts';
import { noindex, socialTitle } from '../../lib/title.ts';

export const Route = createFileRoute('/social/notifications')({
  /*
   * Read and marked read before any loader runs, so the header's bell, which the layout's loader counts, already
   * shows none unread on this page.
   */
  beforeLoad: async ({ context }) => {
    if (!context.member) throw redirect({ href: socialSignInHref('/notifications') });
    const page = await openNotifications();
    if (!page) throw redirect({ href: socialSignInHref('/notifications') });
    return { page };
  },
  loader: ({ context }) => context.page,
  staticData: { section: 'notifications' },
  head: () => ({ meta: [...socialTitle('Notifications'), noindex] }),
  component: Notifications,
});

const ratingName = (id: string) => RATINGS.find((r) => r.id === id)?.label ?? id;

/** Where a notification goes: the post, the person, the problem, or the page that needs them. */
function NoticeLink({ notice, children }: { notice: Notice; children: ReactNode }) {
  switch (notice.kind) {
    case 'reply':
    case 'accepted':
    case 'useful':
      return (
        <Link to="/social/post/$id" params={{ id: String(notice.postId) }}>
          {children}
        </Link>
      );
    case 'follow':
      return (
        <Link to="/social/@{$handle}" params={{ handle: notice.actor.handle }}>
          {children}
        </Link>
      );
    case 'rating':
      return <a href={socialHref(`/problems/${notice.number}#answers`)}>{children}</a>;
    case 'cosign-request':
    case 'cosign-outcome':
      return <a href={socialHref('/me#casebook')}>{children}</a>;
    case 'ticked':
    case 'not-ticked':
    case 'renewal':
      return <a href={socialHref('/verify')}>{children}</a>;
    case 'nominee-joined':
      return <Link to="/social/nominate">{children}</Link>;
  }
}

function Said({ notice: n }: { notice: Notice }) {
  switch (n.kind) {
    case 'reply':
      return (
        <>
          <b>{n.actor.name}</b> replied to “{n.title}”.
        </>
      );
    case 'accepted':
      return (
        <>
          <b>{n.actor.name}</b> marked your reply as the answer to “{n.title}”.
        </>
      );
    case 'useful':
      return (
        <>
          <b>{n.actor.name}</b> found your {n.target} useful on “{n.title}”.
        </>
      );
    case 'follow':
      return (
        <>
          <b>{n.actor.name}</b> followed you.
        </>
      );
    case 'rating':
      return (
        <>
          <b>{n.actor.name}</b> rated your answer to #{n.number} <b>{ratingName(n.rating)}</b>.
        </>
      );
    case 'cosign-request':
      return (
        <>
          <b>{n.actor.name}</b> asked you to co-sign a casebook entry. {n.decision === 'signed' ? 'You co-signed it.' : 'You declined.'}
        </>
      );
    case 'cosign-outcome':
      return (
        <>
          <b>{n.actor.name}</b> {n.outcome === 'signed' ? 'co-signed your casebook entry.' : 'declined to co-sign your casebook entry.'}
        </>
      );
    case 'ticked':
      return (
        <>
          Ticked: <b>{n.label}</b>.
        </>
      );
    case 'not-ticked':
      return (
        <>
          Not ticked: <b>{n.label}</b>. Your email has the team’s reason.
        </>
      );
    case 'renewal':
      return <>We reminded you that your “{n.label}” tick runs to {formatMonth(n.until)}.</>;
    case 'nominee-joined':
      return (
        <>
          <b>{n.account}</b>, whom you nominated, claimed their invite.
        </>
      );
  }
}

function Notifications() {
  const { requests, due, activity } = Route.useLoaderData();
  const decide = useAction(decideCosign);
  const [decided, setDecided] = useState<'signed' | 'declined' | null>(null);
  const answer = async (entry: number, outcome: 'signed' | 'declined') => {
    const result = await decide.run({ entry, outcome });
    if (result?.ok) setDecided(result.value.outcome);
  };
  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <p className="kicker">Notifications</p>
          <h1 className="title">What’s new.</h1>
        </div>
      </div>
      {decide.refusal && (
        <p className="error" role="alert">
          {decide.refusal.message}
        </p>
      )}
      {decided && (
        <p className="note" role="status">
          {decided === 'signed' ? 'Co-signed. It shows on their casebook.' : 'Declined. They see no reason.'}
        </p>
      )}

      <section className="stack" aria-labelledby="needs-title">
        <h2 className="head" id="needs-title">
          Needs you
        </h2>
        {requests.length + due.length === 0 && <p className="small">Nothing waiting on you.</p>}
        {requests.map(({ entry, author }) => (
          <article key={entry.id} className="alert-card card" aria-labelledby={`cosign-${entry.id}`}>
            <div className="by">
              <Avatar name={author.name} track={author.track} sealed={author.sealed} size="sm" />
              <p id={`cosign-${entry.id}`}>
                <Link to="/social/@{$handle}" params={{ handle: author.handle }}>
                  <b>{author.name}</b>
                </Link>{' '}
                asked you to co-sign a casebook entry.
              </p>
              <span className="ago">
                <time dateTime={entry.createdAt}>{formatMoment(entry.createdAt)}</time>
              </span>
            </div>
            <dl className="entry-mini">
              <dt>Work</dt>
              <dd>
                {entry.service} · {entry.industry}
              </dd>
              <dt>Band</dt>
              <dd>{entry.band}</dd>
              <dt>Framework</dt>
              <dd>{entry.framework}</dd>
              <dt>Year</dt>
              <dd>{entry.year}</dd>
              <dt>Their role</dt>
              <dd>{entry.role}</dd>
              {entry.areas.length > 0 && (
                <>
                  <dt>Areas</dt>
                  <dd>{entry.areas.join(', ')}</dd>
                </>
              )}
              {entry.note && (
                <>
                  <dt>Note</dt>
                  <dd>{entry.note}</dd>
                </>
              )}
            </dl>
            <p className="small">Co-sign only if you worked on it or reviewed it. Your name shows on their entry.</p>
            <div className="actions">
              <button className="btn sm" type="button" onClick={() => answer(entry.id, 'signed')}>
                Co-sign<span className="sr-only"> {author.name}’s entry</span>
              </button>
              <button className="btn sm ghost" type="button" onClick={() => answer(entry.id, 'declined')}>
                Decline<span className="sr-only"> {author.name}’s entry</span>
              </button>
            </div>
          </article>
        ))}
        {due.map((claim) => (
          <article key={claim.id} className="alert-card card due">
            <div className="by">
              <Tick source={claim.source} state="ticked" />
              <p>
                <b>
                  Your “{claim.label}” tick renews at the end of {formatMonth(claim.until)}.
                </b>{' '}
                {tally(claim.days, 'day')} left.
              </p>
            </div>
            <p className="small">Send this year’s document and we check it again. If it lapses, the tick shows struck through in red until you do.</p>
            <div className="actions">
              <a className="btn sm" href={socialHref(`/verify?step=${claim.kind === 'body' ? 'body' : 'licence'}`)}>
                Renew it<span className="sr-only">: {claim.label}</span>
              </a>
            </div>
          </article>
        ))}
      </section>

      <section className="stack" id="activity" aria-labelledby="activity-title">
        <h2 className="head" id="activity-title">
          Activity
        </h2>
        {activity.length ? (
          <ul className="alert-list card">
            {activity.map((n) => (
              <li key={n.id} className={n.unread ? 'alert-row unread' : 'alert-row'}>
                <NoticeLink notice={n}>
                  {'actor' in n ? (
                    <Avatar name={n.actor.name} track={n.actor.track} sealed={n.actor.sealed} size="sm" />
                  ) : (
                    <span className="avatar sm" data-track="field" aria-hidden="true">
                      @
                    </span>
                  )}
                  <span>
                    {n.unread && <span className="sr-only">Unread. </span>}
                    <Said notice={n} />
                  </span>
                  <span className="ago">
                    <time dateTime={n.createdAt}>{formatMoment(n.createdAt)}</time>
                  </span>
                </NoticeLink>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty card">
            <p className="head">You’re up to date.</p>
            <p>Follow people and answer problems. Activity lands here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
