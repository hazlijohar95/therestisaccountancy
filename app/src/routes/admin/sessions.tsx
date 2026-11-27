import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { FieldError } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
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
      <Masthead label="Admin" title="Sessions">
        <p>Put a session on the calendar and members see it, say whether they are coming, and get a calendar file and a reminder the day before. Times are Malaysia time.</p>
      </Masthead>

      {shown}

      <section className={`wrap ${s.block}`} aria-labelledby="upcoming-title">
        <h2 className="head" id="upcoming-title">
          On the calendar
        </h2>
        {sessions.length === 0 ? (
          <p className={s.empty}>Nothing scheduled.</p>
        ) : (
          <ol className={s.sessions}>
            {sessions.map((session) => (
              <li className={s.session} key={session.id}>
                <div className="small">{session.when}</div>
                <h3 className={s.title}>{session.title}</h3>
                <p className="small">{session.coming}</p>
                <details className={s.confirm}>
                  <summary>Call it off</summary>
                  <form
                    method="POST"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onCancel(session.id);
                    }}
                  >
                    <span className="small">Everyone coming gets an email saying it is off.</span>
                    <button className="btn" type="submit" disabled={busy}>
                      Call it off
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="add-title">
        <h2 className="head" id="add-title">
          Add a session
        </h2>
        <form method="POST" className={s.form} onSubmit={onAdd}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input className="input" id="title" name="title" required maxLength={120} {...title.input} />
            <FieldError field={title} className={s.error} />
          </div>
          <div className="field">
            <label htmlFor="kind">Kind</label>
            <select className="input" id="kind" name="kind">
              {kinds.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </div>
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
            <input className="input" id="minutes" name="minutes" type="number" min="15" max="480" step="5" required defaultValue="60" {...minutes.input} />
            <FieldError field={minutes} className={s.error} />
          </div>
          <div className="field">
            <label htmlFor="link">Call link</label>
            <input className="input" id="link" name="link" type="url" placeholder="https://" required {...link.input} />
            <span className="hint">Only members see it.</span>
            <FieldError field={link} className={s.error} />
          </div>
          <div className="field">
            <label htmlFor="detail">
              What it covers <span className="hint">(optional)</span>
            </label>
            <textarea className="input" id="detail" name="detail" rows={4} maxLength={1000} {...detail.input} />
            <FieldError field={detail} className={s.error} />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Add session
          </button>
        </form>
      </section>
    </>
  );
}
