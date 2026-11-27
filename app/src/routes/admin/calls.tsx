import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { FieldError } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
import { adminCalls, cancelSlot, openSlot, type SlotForm } from '../../functions/admin-calls.ts';
import { failureOf } from '../../lib/outcome.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './calls.module.css';

export const Route = createFileRoute('/admin/calls')({
  loader: () => adminCalls(),
  head: () => ({ meta: clubTitle('One-to-one · Admin') }),
  component: Calls,
});

function Calls() {
  const { slots, lastLink, today, minutes } = Route.useLoaderData();
  const open = useAction(openSlot, { refresh: 'always' });
  const cancel = useAction(cancelSlot, { refresh: 'always' });
  const busy = open.busy || cancel.busy;
  const [shown, setShown] = useState<ReactNode>(null);
  const date = open.field('date');
  const time = open.field('time');
  const lengthField = open.field('minutes');
  const link = open.field('link');

  const onOpen = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const posted = new FormData(form);
    const field = (name: keyof SlotForm) => String(posted.get(name) ?? '');
    const outcome = await open.run({ date: field('date'), time: field('time'), minutes: field('minutes'), link: field('link') });
    if (!outcome) return;
    if (!outcome.ok) return setShown(failureOf(outcome) && <Notice tone="error">{outcome.message}</Notice>);
    form.reset();
    setShown(<Notice>Slot opened. Members can book it now.</Notice>);
  };

  const onCancel = async (slot: number) => {
    const outcome = await cancel.run({ slot });
    if (!outcome) return;
    setShown(outcome.ok ? <Notice>Slot cancelled. {outcome.value ? `${outcome.value} has been emailed.` : 'Nobody had booked it.'}</Notice> : <Notice tone="error">{outcome.message}</Notice>);
  };

  return (
    <>
      <Masthead label="Admin" title="One-to-one calls">
        <p>
          Open a slot and members can book it until two hours before it starts. Whoever books says what they are stuck on, and you get that by email with a calendar invite, then a
          reminder the day before. Times are Malaysia time.
        </p>
      </Masthead>

      {shown}

      <section className={`wrap ${s.block}`} aria-labelledby="upcoming-title">
        <h2 className="head" id="upcoming-title">
          Coming up
        </h2>
        {slots.length === 0 ? (
          <p className={s.empty}>No slots open. Open one below and members see it straight away.</p>
        ) : (
          <ol className={s.slots}>
            {slots.map((slot) => (
              <li className={s.slot} key={slot.id}>
                <div className="small">
                  <time dateTime={slot.startsAt}>{slot.when}</time> · {slot.minutes} min · with {slot.host}
                </div>
                {slot.booking ? (
                  <>
                    <h3 className={s.title}>{slot.booking.name}</h3>
                    <p className={s.topic}>{slot.booking.topic}</p>
                    <p className="small">
                      <a href={`mailto:${slot.booking.email}`}>{slot.booking.email}</a> · booked {slot.booking.bookedAt}
                    </p>
                  </>
                ) : (
                  <h3 className={s.title}>Not booked yet</h3>
                )}
                <p className={`small ${s.link}`}>
                  <a href={slot.link} rel="noopener">
                    {slot.link}
                  </a>
                </p>
                <details className={s.confirm}>
                  <summary>Cancel the slot</summary>
                  <form
                    method="POST"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onCancel(slot.id);
                    }}
                  >
                    <span className="small">{slot.booking ? `${slot.booking.name} gets an email saying it is off.` : 'Nobody has booked it, so nobody is told.'}</span>
                    <button className="btn" type="submit" disabled={busy}>
                      Cancel the slot
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="open-title">
        <h2 className="head" id="open-title">
          Open a slot
        </h2>
        <form method="POST" className={s.form} onSubmit={onOpen} key={lastLink}>
          <div className={s.pair}>
            <div className="field">
              <label htmlFor="date">Date</label>
              <input className="input" id="date" name="date" type="date" min={today} required {...date.input} />
              <FieldError field={date} className={s.error} />
            </div>
            <div className="field">
              <label htmlFor="time">Start, Malaysia time</label>
              <input className="input" id="time" name="time" type="time" required {...time.input} />
              <FieldError field={time} className={s.error} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="minutes">Length in minutes</label>
            <input className="input" id="minutes" name="minutes" type="number" min={minutes.min} max={minutes.max} step="5" required defaultValue="30" {...lengthField.input} />
            <span className="hint">
              Between {minutes.min} and {minutes.max}.
            </span>
            <FieldError field={lengthField} className={s.error} />
          </div>
          <div className="field">
            <label htmlFor="link">Call link</label>
            <input className="input" id="link" name="link" type="url" placeholder="https://" required defaultValue={lastLink} {...link.input} />
            <span className="hint">Only the member who books it sees it. Filled in with the link you used last.</span>
            <FieldError field={link} className={s.error} />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Open the slot
          </button>
        </form>
      </section>
    </>
  );
}
