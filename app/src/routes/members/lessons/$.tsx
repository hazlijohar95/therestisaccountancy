import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { Notice } from '../../../components/members/Notice.tsx';
import { TemplateList } from '../../../components/members/TemplateList.tsx';
import { lessonDone, membersLesson } from '../../../functions/members-learning.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './$.module.css';

export const Route = createFileRoute('/members/lessons/$')({
  loader: ({ params }) => membersLesson({ data: params._splat ?? '' }),
  head: ({ loaderData }) => ({ meta: clubTitle(loaderData?.title) }),
  component: Lesson,
});

function Lesson() {
  const lesson = Route.useLoaderData();
  const router = useRouter();
  const mark = useServerFn(lessonDone);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await mark({ data: { lesson: lesson.id, done: !lesson.done } });
    setError(outcome.ok ? null : outcome.message);
    if (outcome.ok) await router.invalidate();
  };

  return (
    <>
      <section className="night">
        <div className={`wrap ${s.masthead}`}>
          <p className={`label ${s.top}`}>
            <a href={lesson.programme.href}>{lesson.programme.name}</a> / Module {lesson.module} · {lesson.programme.topic}
          </p>
          <h1 className={`headline serif ${s.headline}`}>{lesson.title}</h1>
          <p className="small">{lesson.minutes} minute read</p>
        </div>
      </section>
      {error && <Notice tone="error">{error}</Notice>}
      <article className={`wrap ${s.body}`}>
        <div className={s.prose} dangerouslySetInnerHTML={{ __html: lesson.html }} />
        {lesson.templates.length > 0 && (
          <section className={s.templates} aria-labelledby="templates-title">
            <h2 className="label" id="templates-title">
              Templates for this module
            </h2>
            <TemplateList items={lesson.templates} />
          </section>
        )}
        <form method="POST" className={s.done} onSubmit={toggle}>
          <p>{lesson.done ? 'You marked this lesson done.' : 'Finished it?'}</p>
          <button className={lesson.done ? 'btn ghost' : 'btn'} type="submit">
            {lesson.done ? 'Mark as not done' : 'Mark as done'}
          </button>
        </form>
        <nav className={s.pager} aria-label="Other lessons">
          {lesson.previous ? (
            <a href={lesson.previous.href}>
              <span className="label">Previous</span>
              <span className="serif">{lesson.previous.title}</span>
            </a>
          ) : (
            <span></span>
          )}
          {lesson.next && (
            <a className={s.next} href={lesson.next.href}>
              <span className="label">Next</span>
              <span className="serif">{lesson.next.title}</span>
            </a>
          )}
        </nav>
      </article>
    </>
  );
}
