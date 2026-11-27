import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAction } from '../../components/useAction.ts';
import { Empty } from '../../components/ui/Empty.tsx';
import { Field, Form } from '../../components/ui/Form.tsx';
import { List, Meta, Row } from '../../components/ui/List.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Points } from '../../components/ui/Points.tsx';
import { Section } from '../../components/ui/Section.tsx';
import { Confirm } from '../../components/ui/Table.tsx';
import { addSession, adminSessions, cancelSession, type SessionForm } from '../../functions/admin-sessions.ts';
import { failureOf } from '../../lib/outcome.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './sessions.module.css';

export const Route = createFileRoute('/admin/sessions')({
  loader: () => adminSessions(),
  head: () => ({ meta: clubTitle('Sessions · Admin') }),
  component: Sessions,
});

const told = (n: number) => (n === 0 ? 'Nobody had said they were coming.' : n === 1 ? 'The one member coming has been emailed.' : `The ${n} members coming have been emailed.`);

function Sessions() {
  const { sessions, today, kinds } = Route.useLoaderData();
  const add = useAction(addSession, { refresh: 'always' });
  const cancel = useAction(cancelSession, { refresh: 'always' });
  const busy = add.busy || cancel.busy;
  const [shown, setShown] = useState<ReactNode>(null);
  const title = add.field('title');
  const date = add.field('date');
  const time = add.field('time');
  const minutes = add.field('minutes');
  const link = add.field('link');
  const detail = add.field('detail');

  const onAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const posted = new FormData(form);
    const field = (name: keyof SessionForm) => String(posted.get(name) ?? '');
    const outcome = await add.run({ title: field('title'), kind: field('kind'), date: field('date'), time: field('time'), minutes: field('minutes'), link: field('link'), detail: field('detail') });
    if (!outcome) return;
    if (!outcome.ok) return setShown(failureOf(outcome) && <Notice tone="error">{outcome.message}</Notice>);
    form.reset();
    setShown(<Notice>Session added. Members see it now.</Notice>);
  };

  const onCancel = async (session: number) => {
    const outcome = await cancel.run({ session });
    if (!outcome) return;
    setShown(outcome.ok ? <Notice>Session called off. {told(outcome.value)}</Notice> : <Notice tone="error">{outcome.message}</Notice>);
  };

  return (
    <>
      <PageHead label="Admin" title="Sessions" lead="Times are Malaysia time." />

      {shown}

      <Section title="On the calendar">
        {sessions.length === 0 ? (
          <Empty icon="calendar">Nothing scheduled.</Empty>
        ) : (
          <List ordered>
            {sessions.map((session) => (
              <Row
                key={session.id}
                title={session.title}
                meta={
                  <>
                    <Meta icon="clock">{session.when}</Meta>
                    <Meta icon="users">{session.coming}</Meta>
                  </>
                }
                trail={
                  <Confirm summary="Call it off">
                    <form
                      method="POST"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void onCancel(session.id);
                      }}
                    >
                      <span className="small">Everyone coming gets an email.</span>
                      <button className="btn" type="submit" disabled={busy}>
                        Call it off
                      </button>
                    </form>
                  </Confirm>
                }
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="Add a session">
        <Points
          items={[
            { icon: 'users', text: 'Members see it and say if they are coming' },
            { icon: 'calendar', text: 'They get a calendar file' },
            { icon: 'mail', text: 'A reminder the day before' },
          ]}
        />
        <Form wide onSubmit={onAdd}>
          <Field label="Title" id="title" field={title}>
            <input className="input" id="title" name="title" required maxLength={120} {...title.input} />
          </Field>
          <Field label="Kind" id="kind">
            <select className="input" id="kind" name="kind">
              {kinds.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </Field>
          <div className={s.pair}>
            <Field label="Date" id="date" field={date}>
              <input className="input" id="date" name="date" type="date" min={today} required {...date.input} />
            </Field>
            <Field label="Start, Malaysia time" id="time" field={time}>
              <input className="input" id="time" name="time" type="time" required {...time.input} />
            </Field>
          </div>
          <Field label="Length in minutes" id="minutes" field={minutes}>
            <input className="input" id="minutes" name="minutes" type="number" min="15" max="480" step="5" required defaultValue="60" {...minutes.input} />
          </Field>
          <Field label="Call link" id="link" hint="Only members see it." field={link}>
            <input className="input" id="link" name="link" type="url" placeholder="https://" required {...link.input} />
          </Field>
          <Field label="What it covers" id="detail" hint="Optional." field={detail}>
            <textarea className="input" id="detail" name="detail" rows={4} maxLength={1000} {...detail.input} />
          </Field>
          <button className="btn" type="submit" disabled={busy}>
            Add session
          </button>
        </Form>
      </Section>
    </>
  );
}
