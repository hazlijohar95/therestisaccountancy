import { createFileRoute } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { TemplateList } from '../../../components/members/TemplateList.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Meta } from '../../../components/ui/List.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { PageHead } from '../../../components/ui/PageHead.tsx';
import { Section } from '../../../components/ui/Section.tsx';
import { useAction } from '../../../components/useAction.ts';
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
  const mark = useAction(lessonDone);

  const toggle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await mark.run({ lesson: lesson.id, done: !lesson.done });
  };

  return (
    <>
      <PageHead
        label={
          <span>
            <a href={lesson.programme.href}>{lesson.programme.name}</a> / Module {lesson.module} · {lesson.programme.topic}
          </span>
        }
        title={lesson.title}
        lead={<Meta icon="clock">{lesson.minutes} minute read</Meta>}
      />
      {mark.refusal && <Notice tone="error">{mark.refusal.message}</Notice>}
      <article className={`wrap ${s.body}`}>
        <div className={s.prose} dangerouslySetInnerHTML={{ __html: lesson.html }} />
      </article>
      {lesson.templates.length > 0 && (
        <Section title="Templates for this module">
          <TemplateList items={lesson.templates} />
        </Section>
      )}
      <div className={`wrap ${s.end}`}>
        <form method="POST" className={s.done} onSubmit={toggle}>
          <p>{lesson.done ? <Badge tone="solid">Done</Badge> : 'Finished it?'}</p>
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
      </div>
    </>
  );
}
