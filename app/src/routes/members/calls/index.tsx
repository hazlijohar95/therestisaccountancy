import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { firstName, formatTime, formatWeekday } from '../../../../../src/lib/format.ts';
import { Masthead } from '../../../components/club/Masthead.tsx';
import { Notice } from '../../../components/club/Notice.tsx';
import { FieldError } from '../../../components/FieldError.tsx';
import { useAction } from '../../../components/useAction.ts';
import { bookCall, cancelCall, membersCalls } from '../../../functions/members-calls.ts';
import { flags } from '../../../components/members/flags.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './index.module.css';
import { hostFirstName } from '../../../../../src/data/authors.ts';

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
      <Masthead label="One-to-one" title={`Stuck? Talk it through with ${hostFirstName}.`} narrow>
        <p>Bring the quote you can't price, the client you can't read or the decision you keep putting off. Say what it is when you book, so {hostFirstName} comes ready.</p>
      </Masthead>

      {search.booked && mine && <Notice>Booked. A confirmation with the calendar invite is on its way to {email}.</Notice>}
      {search.cancelled && !mine && <Notice>Cancelled. {hostFirstName} has been told.</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      {mine && (
        <section className={`wrap ${s.block}`} aria-labelledby="mine-title">
          <h2 className="head" id="mine-title">
            Your call
          </h2>
          <div className={s.call}>
            <p className="small">
              <time dateTime={mine.startsAt}>
                {formatWeekday(mine.startsAt)}, {formatTime(mine.startsAt)}
              </time>{' '}
              · {mine.minutes} min{started && <b> · On now</b>}
            </p>
            <h3 className={`title ${s.title}`}>With {mine.host}</h3>
            <p className={s.topic}>
              <span className="label">You said</span> {mine.topic}
            </p>
            <div className={s.row}>
              <a className="btn" href={mine.link} rel="noopener">
                Join the call
              </a>
              <a href={`/members/calls/${mine.id}.ics`}>Add to calendar</a>
            </div>
            <details className={s.confirm}>
              <summary>Cancel the call</summary>
              <form method="POST" onSubmit={submitCancel(mine.id)}>
                <span className="small">
                  {firstName(mine.host)} gets an email saying you can't make it. Cancel more than two hours ahead and the time goes back on the list for someone else.
                </span>
                <button className="btn" type="submit">
                  Cancel the call
                </button>
              </form>
            </details>
          </div>
        </section>
      )}

      <section className={`wrap ${s.block}`} aria-labelledby="open-title">
        <h2 className="head" id="open-title">
          {mine ? 'Other open times' : 'Book a call'}
        </h2>
        {days.length === 0 ? (
          <p className={s.empty}>
            No open times right now. New ones appear here as {hostFirstName} adds them. Until then, the <a href="/members/community">members' room</a> is open all week.
          </p>
        ) : (
          <>
            {mine && <p className={s.hold}>You can hold one call at a time. To take one of these instead, cancel yours first.</p>}
            <div className={s.days}>
              {days.map((day) => (
                <div key={day.date} className={s.day} role="group" aria-labelledby={`day-${day.date}`}>
                  <h3 className="label" id={`day-${day.date}`}>
                    {formatWeekday(day.slots[0]?.startsAt ?? day.date)}
                  </h3>
                  <ul className={s.slots}>
                    {day.slots.map((slot) => {
                      const inside = (
                        <>
                          {!mine && <input form="book" type="radio" name="slot" value={slot.id} required />}
                          <time className={s.time} dateTime={slot.startsAt}>
                            {formatTime(slot.startsAt)}
                          </time>
                          <span className="small">
                            {slot.minutes} min · with {slot.host}
                          </span>
                        </>
                      );
                      /* A member holding a call still sees the other times, as a list with nothing to pick: one call at a time. */
                      return <li key={slot.id}>{mine ? <div className={s.slot}>{inside}</div> : <label className={s.slot}>{inside}</label>}</li>;
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {!mine && (
              <form id="book" method="POST" className={s.book} onSubmit={submitBooking}>
                {slotField.error && <span className={`error ${s.error}`}>{slotField.error}</span>}
                <div className="field">
                  <label htmlFor="topic">What are you stuck on?</label>
                  <textarea
                    className={`input ${s.textarea}`}
                    id="topic"
                    name="topic"
                    rows={3}
                    maxLength={topicMax}
                    required
                    {...topic.input}
                  />
                  <span className="hint" id="topic-hint">
                    A sentence or two is plenty. Only {hostFirstName} sees it.
                  </span>
                  <FieldError field={topic} className={s.error} />
                </div>
                <button className="btn" type="submit">
                  Book the call
                </button>
              </form>
            )}
          </>
        )}
        <p className="small">Times are Malaysia time. Booking closes two hours before a call starts.</p>
      </section>
    </>
  );
}
