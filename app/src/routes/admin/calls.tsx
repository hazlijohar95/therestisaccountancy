import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAction } from '../../components/useAction.ts';
import { Badge } from '../../components/ui/Badge.tsx';
import { Empty } from '../../components/ui/Empty.tsx';
import { Field, Form } from '../../components/ui/Form.tsx';
import { DateTile, List, Meta, Row } from '../../components/ui/List.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Points } from '../../components/ui/Points.tsx';
import { Section } from '../../components/ui/Section.tsx';
import { Confirm } from '../../components/ui/Table.tsx';
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
      <PageHead label="Admin" title="One-to-one calls" lead="Times are Malaysia time." />

      {shown}

      <Section title="Coming up">
        {slots.length === 0 ? (
          <Empty icon="calendar">No slots open. Open one below and members see it at once.</Empty>
        ) : (
          <List ordered>
            {slots.map((slot) => (
              <Row
                key={slot.id}
                lead={<DateTile at={slot.startsAt} />}
                title={slot.booking ? slot.booking.name : 'Not booked yet'}
                meta={
                  <>
                    {slot.booking ? <Badge tone="solid">Booked</Badge> : <Badge>Open</Badge>}
                    <Meta icon="clock">
                      <time dateTime={slot.startsAt}>{slot.when}</time>, {slot.minutes} min
                    </Meta>
                    <Meta icon="users">With {slot.host}</Meta>
                  </>
                }
                trail={
                  <Confirm summary="Cancel the slot">
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
                  </Confirm>
                }
              >
                {slot.booking && (
                  <>
                    <p>{slot.booking.topic}</p>
                    <div className={`small ${s.facts}`}>
                      <Meta icon="mail">
                        <a href={`mailto:${slot.booking.email}`}>{slot.booking.email}</a>
                      </Meta>
                      <span>Booked {slot.booking.bookedAt}</span>
                    </div>
                  </>
                )}
                <div className={`small ${s.link}`}>
                  <Meta icon="play">
                    <a href={slot.link} rel="noopener">
                      {slot.link}
                    </a>
                  </Meta>
                </div>
              </Row>
            ))}
          </List>
        )}
      </Section>

      <Section title="Open a slot">
        <Points
          items={[
            { icon: 'clock', text: 'Bookable until two hours before it starts' },
            { icon: 'file', text: 'Whoever books says what they are stuck on' },
            { icon: 'mail', text: 'You get that by email with a calendar invite' },
            { icon: 'repeat', text: 'Then a reminder the day before' },
          ]}
        />
        <Form wide onSubmit={onOpen} key={lastLink}>
          <div className={s.pair}>
            <Field label="Date" id="date" field={date}>
              <input className="input" id="date" name="date" type="date" min={today} required {...date.input} />
            </Field>
            <Field label="Start, Malaysia time" id="time" field={time}>
              <input className="input" id="time" name="time" type="time" required {...time.input} />
            </Field>
          </div>
          <Field label="Length in minutes" id="minutes" hint={`Between ${minutes.min} and ${minutes.max}.`} field={lengthField}>
            <input className="input" id="minutes" name="minutes" type="number" min={minutes.min} max={minutes.max} step="5" required defaultValue="30" {...lengthField.input} />
          </Field>
          <Field label="Call link" id="link" hint="Only the member who books sees it. Filled in with your last link." field={link}>
            <input className="input" id="link" name="link" type="url" placeholder="https://" required defaultValue={lastLink} {...link.input} />
          </Field>
          <button className="btn" type="submit" disabled={busy}>
            Open the slot
          </button>
        </Form>
      </Section>
    </>
  );
}
