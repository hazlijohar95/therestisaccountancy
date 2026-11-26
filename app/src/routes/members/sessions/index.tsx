import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { week } from '../../../../../src/data/club.ts';
import { formatDay, formatMoment } from '../../../../../src/lib/format.ts';
import { Masthead } from '../../../components/members/Masthead.tsx';
import { Notice } from '../../../components/members/Notice.tsx';
import { Steps } from '../../../components/members/Steps.tsx';
import { membersSessions, rsvp } from '../../../functions/members-sessions.ts';
import type { Outcome } from '../../../lib/outcome.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './index.module.css';

export const Route = createFileRoute('/members/sessions/')({
  loader: () => membersSessions(),
  head: () => ({ meta: clubTitle('Sessions') }),
  component: Sessions,
});

const started = (startsAt: string) => new Date(startsAt).getTime() <= Date.now();

function Sessions() {
  const { upcoming, recordings } = Route.useLoaderData();
  const router = useRouter();
  const answer = useServerFn(rsvp);
  const [answered, setAnswered] = useState<Outcome<{ going: boolean }> | null>(null);

  const say = async (session: number, going: boolean) => {
    setAnswered(await answer({ data: { session, going } }));
    await router.invalidate();
  };

  return (
    <>
      <Masthead label="Sessions" title="Live every week. Recorded for the weeks you miss." narrow />
      {answered?.ok && <Notice>{answered.value.going ? 'You are down for it. A calendar file is on its way by email.' : 'Noted. You are no longer down for it.'}</Notice>}
      {answered && !answered.ok && <Notice tone="error">{answered.message}</Notice>}
      <section className={`wrap ${s.block}`} aria-labelledby="coming-title">
        <h2 className="head" id="coming-title">
          Coming up
        </h2>
        {upcoming.length === 0 ? (
          <p className={s.empty}>Nothing scheduled yet. New sessions appear here, and in the Monday email.</p>
        ) : (
          <ol className={s.sessions}>
            {upcoming.map((session) => (
              <li key={session.id} className={s.session}>
                <div className="when small">
                  <time dateTime={session.startsAt}>{formatMoment(session.startsAt)}</time> · {session.minutes} min · {session.kind}
                  {started(session.startsAt) && <b> · On now</b>}
                </div>
                <h3 className={`title ${s.title}`}>{session.title}</h3>
                {session.detail && <p className={s.detail}>{session.detail}</p>}
                <p className="small">{session.going === 0 ? 'Nobody has said yet.' : session.going === 1 ? '1 member coming.' : `${session.going} members coming.`}</p>
                <form
                  method="POST"
                  className={s.row}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void say(session.id, !session.attending);
                  }}
                >
                  {session.attending ? (
                    <>
                      <a className="btn" href={session.link} rel="noopener">
                        Join the call
                      </a>
                      <a href={`/members/sessions/${session.id}.ics`}>Add to calendar</a>
                      <button className={s.link}>I can't make it</button>
                    </>
                  ) : (
                    <button className="btn">I'm coming</button>
                  )}
                </form>
              </li>
            ))}
          </ol>
        )}
        <p className="small">Times are Malaysia time.</p>
      </section>
      <section className={`wrap ${s.block}`} aria-labelledby="kinds-title">
        <h2 className="head" id="kinds-title">
          Three kinds of session
        </h2>
        <Steps items={week.sessions} />
        <dl className="facts">
          {week.between.map(({ term, detail }) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>
                {detail}
                {term === 'When you’re stuck' && (
                  <>
                    {' '}
                    <a href="/members/calls">Book a call</a>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={`wrap ${s.block}`} aria-labelledby="recordings-title">
        <h2 className="head" id="recordings-title">
          Recordings
        </h2>
        {recordings.length === 0 ? (
          <p className={s.empty}>No recordings yet. Each session's recording is added here after it airs.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Session</th>
                <th>Kind</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={r.url}>{r.title}</a>
                  </td>
                  <td>{r.kind}</td>
                  <td>{formatDay(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
