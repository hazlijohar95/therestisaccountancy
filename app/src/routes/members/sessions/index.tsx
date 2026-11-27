import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { week } from '../../../../../src/data/club.ts';
import { roomPath } from '../../../../../src/data/social.ts';
import { formatDay, formatTime } from '../../../../../src/lib/format.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Empty } from '../../../components/ui/Empty.tsx';
import { Icon } from '../../../components/ui/Icon.tsx';
import { DateTile, List, Meta, Row } from '../../../components/ui/List.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { PageHead } from '../../../components/ui/PageHead.tsx';
import { Points } from '../../../components/ui/Points.tsx';
import { Actions, Section } from '../../../components/ui/Section.tsx';
import { Steps } from '../../../components/ui/Steps.tsx';
import { useAction } from '../../../components/useAction.ts';
import { membersSessions, rsvp } from '../../../functions/members-sessions.ts';
import { socialHref } from '../../../lib/links.ts';
import { clubTitle } from '../../../lib/title.ts';

export const Route = createFileRoute('/members/sessions/')({
  loader: () => membersSessions(),
  head: () => ({ meta: clubTitle('Sessions') }),
  component: Sessions,
});

const started = (startsAt: string) => new Date(startsAt).getTime() <= Date.now();

function Sessions() {
  const { upcoming, recordings } = Route.useLoaderData();
  const answer = useAction(rsvp, { refresh: 'always' });
  const [told, setTold] = useState<boolean | null>(null);

  const say = async (session: number, going: boolean) => {
    const outcome = await answer.run({ session, going });
    if (!outcome) return;
    setTold(outcome.ok ? outcome.value.going : null);
  };

  return (
    <>
      <PageHead label="Sessions" title="Live every week." lead="Recorded for the weeks you miss. Times are Malaysia time." />
      {told !== null && <Notice>{told ? 'You are going. A calendar file is on its way.' : 'Noted. You are not going.'}</Notice>}
      {answer.refusal && <Notice tone="error">{answer.refusal.message}</Notice>}

      <Section title="Coming up">
        {upcoming.length === 0 ? (
          <Empty icon="calendar">Nothing scheduled yet. New sessions show here and in the Monday email.</Empty>
        ) : (
          <List ordered>
            {upcoming.map((session) => (
              <Row
                key={session.id}
                lead={<DateTile at={session.startsAt} />}
                title={session.title}
                meta={
                  <>
                    {started(session.startsAt) ? <Badge tone="live">On now</Badge> : <Badge>{session.kind}</Badge>}
                    <Meta icon="clock">
                      {formatTime(session.startsAt)}, {session.minutes} min
                    </Meta>
                    <Meta icon="users">{session.going} going</Meta>
                  </>
                }
                trail={
                  <form
                    method="POST"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void say(session.id, !session.attending);
                    }}
                  >
                    <Actions>
                      {session.attending ? (
                        <>
                          <a className="btn" href={session.link} rel="noopener">
                            Join the call
                          </a>
                          <a href={`/members/sessions/${session.id}.ics`}>Add to calendar</a>
                          <button className="btn ghost">Can't make it</button>
                        </>
                      ) : (
                        <button className="btn">I'm coming</button>
                      )}
                    </Actions>
                  </form>
                }
              >
                {session.detail && <p className="small">{session.detail}</p>}
              </Row>
            ))}
          </List>
        )}
      </Section>

      <Section title="Three kinds">
        <Steps items={week.sessions.map(({ term, detail }) => ({ label: term, detail }))} />
        <Points
          items={[
            { icon: 'users', text: <a href={socialHref(roomPath('club'))}>The members' room, open all week</a> },
            { icon: 'clock', text: <a href="/members/calls">Stuck? Book a one-to-one</a> },
          ]}
        />
      </Section>

      <Section title="Recordings">
        {recordings.length === 0 ? (
          <Empty icon="play">No recordings yet. Each one lands here after it airs.</Empty>
        ) : (
          <List>
            {recordings.map((r) => (
              <Row key={r.id} lead={<Icon name="play" />} title={<a href={r.url}>{r.title}</a>} meta={`${r.kind}, ${formatDay(r.date)}`} />
            ))}
          </List>
        )}
      </Section>
    </>
  );
}

