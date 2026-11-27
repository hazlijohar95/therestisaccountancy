import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { hostFirstName } from '../../../../../src/data/authors.ts';
import { roomPath } from '../../../../../src/data/social.ts';
import { firstName, formatTime, formatWeekday } from '../../../../../src/lib/format.ts';
import { FieldError } from '../../../components/FieldError.tsx';
import { flags } from '../../../components/members/flags.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Empty } from '../../../components/ui/Empty.tsx';
import { Field, Form } from '../../../components/ui/Form.tsx';
import { DateTile, List, Meta, Row } from '../../../components/ui/List.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { PageHead } from '../../../components/ui/PageHead.tsx';
import { Points } from '../../../components/ui/Points.tsx';
import { Actions, Section } from '../../../components/ui/Section.tsx';
import { Confirm } from '../../../components/ui/Table.tsx';
import { useAction } from '../../../components/useAction.ts';
import { bookCall, cancelCall, membersCalls } from '../../../functions/members-calls.ts';
import { socialHref } from '../../../lib/links.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './index.module.css';

export const Route = createFileRoute('/members/calls/')({
  validateSearch: flags('booked', 'cancelled'),
  loader: () => membersCalls(),
  head: () => ({ meta: clubTitle('One-to-one') }),
  component: Calls,
});

function Calls() {
  const { email, mine, days, topicMax } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const book = useAction(bookCall, { refresh: 'never' });
  const cancel = useAction(cancelCall, { refresh: 'never' });
  const slotField = book.field('slot');
  const topic = book.field('topic', { hint: 'topic-hint' });
  /* Only one of the two forms shows at a time, so at most one of them has a failure to show. */
  const failure = book.failure ?? cancel.failure;
  const started = mine !== null && new Date(mine.startsAt).getTime() <= Date.now();

  /* Each lands on a plain address, so a refresh never posts twice and the notice says what happened. */
  const submitBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await book.run({ slot: String(form.get('slot') ?? ''), topic: String(form.get('topic') ?? '') });
    if (!result?.ok) return;
    await navigate({ to: '/members/calls', search: { booked: true } });
    await router.invalidate();
  };
  const submitCancel = (slot: number) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await cancel.run({ slot });
    if (!result?.ok) return;
    await navigate({ to: '/members/calls', search: { cancelled: true } });
    await router.invalidate();
  };

  return (
    <>
      <PageHead label="One-to-one" title={`Stuck? Talk it through with ${hostFirstName}.`} lead="Bring the quote you can't price, the client you can't read or the decision you keep putting off." />

      {search.booked && mine && <Notice>Booked. A confirmation with the calendar invite is on its way to {email}.</Notice>}
      {search.cancelled && !mine && <Notice>Cancelled. {hostFirstName} has been told.</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      {mine && (
        <Section title="Your call">
          <List>
            <Row
              lead={<DateTile at={mine.startsAt} />}
              title={`With ${mine.host}`}
              meta={
                <>
                  {started && <Badge tone="live">On now</Badge>}
                  <Meta icon="clock">
                    <time dateTime={mine.startsAt}>{formatTime(mine.startsAt)}</time>, {mine.minutes} min
                  </Meta>
                </>
              }
              trail={
                <Actions>
                  <a className="btn" href={mine.link} rel="noopener">
                    Join the call
                  </a>
                  <a href={`/members/calls/${mine.id}.ics`}>Add to calendar</a>
                </Actions>
              }
            >
              <p className="small">
                <span className="label">You said</span> {mine.topic}
              </p>
              <Confirm summary="Cancel the call">
                <form method="POST" onSubmit={submitCancel(mine.id)}>
                  <span className="small">{firstName(mine.host)} is emailed. Cancel more than two hours ahead and the time goes back on the list.</span>
                  <button className="btn" type="submit">
                    Cancel the call
                  </button>
                </form>
              </Confirm>
            </Row>
          </List>
        </Section>
      )}

      <Section title={mine ? 'Other open times' : 'Book a call'}>
        {days.length === 0 ? (
          <Empty icon="calendar">
            No open times right now. New ones show here as {hostFirstName} adds them. The <a href={socialHref(roomPath('club'))}>members' room</a> is open all week.
          </Empty>
        ) : (
          <>
            <List>
              {days.map((day) => {
                const first = day.slots[0]?.startsAt ?? day.date;
                return (
                  <Row key={day.date} lead={<DateTile at={first} />} title={<span id={`day-${day.date}`}>{formatWeekday(first)}</span>}>
                    <div role="group" aria-labelledby={`day-${day.date}`}>
                      <ul className={s.slots}>
                        {day.slots.map((slot) => {
                          const inside = (
                            <>
                              {!mine && <input form="book" type="radio" name="slot" value={slot.id} required />}
                              <time className={s.time} dateTime={slot.startsAt}>
                                {formatTime(slot.startsAt)}
                              </time>
                              <span className="small">
                                {slot.minutes} min, {slot.host}
                              </span>
                            </>
                          );
                          /* A member holding a call still sees the other times, as a list with nothing to pick: one call at a time. */
                          return <li key={slot.id}>{mine ? <div className={s.slot}>{inside}</div> : <label className={s.slot}>{inside}</label>}</li>;
                        })}
                      </ul>
                    </div>
                  </Row>
                );
              })}
            </List>
            {!mine && (
              <Form id="book" onSubmit={submitBooking}>
                {slotField.error && (
                  <div className="field">
                    <FieldError field={slotField} />
                  </div>
                )}
                <Field label="What are you stuck on?" id="topic" hint={`A sentence or two. Only ${hostFirstName} sees it.`} field={topic}>
                  <textarea className="input" id="topic" name="topic" rows={3} maxLength={topicMax} required {...topic.input} />
                </Field>
                <button className="btn" type="submit">
                  Book the call
                </button>
              </Form>
            )}
          </>
        )}
        <Points
          items={[
            { icon: 'clock', text: 'Malaysia time' },
            { icon: 'lock', text: 'Booking closes two hours before a call' },
            { icon: 'users', text: mine ? 'One call at a time. To take another, cancel yours first.' : 'One call at a time' },
          ]}
        />
      </Section>
    </>
  );
}
