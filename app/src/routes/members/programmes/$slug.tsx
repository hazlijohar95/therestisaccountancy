import { createFileRoute } from '@tanstack/react-router';
import { TemplateList } from '../../../components/members/TemplateList.tsx';
import { membersProgramme } from '../../../functions/members-learning.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './$slug.module.css';

export const Route = createFileRoute('/members/programmes/$slug')({
  loader: ({ params }) => membersProgramme({ data: params.slug }),
  head: ({ loaderData }) => ({ meta: clubTitle(loaderData?.name) }),
  component: Programme,
});

const count = (n: number) => String(n).padStart(2, '0');

function Programme() {
  const programme = Route.useLoaderData();
  return (
    <>
      <section className="night">
        <div className={`wrap ${s.masthead}`}>
          <p className={`label ${s.top}`}>
            <a href="/members">Overview</a> / Programme
          </p>
          <h1 className={`headline serif ${s.headline}`}>{programme.name}</h1>
          <p className={`lead ${s.lead}`}>
            {programme.promise} {programme.done} of {programme.published} published lessons done.
          </p>
        </div>
      </section>
      <section className={`wrap ${s.modules}`} aria-label="Modules">
        {programme.modules.map(({ topic, lessons, templates, deliverable }, i) => (
          <article key={topic} className={s.module}>
            <span className={`serif ${s.n}`}>{count(i + 1)}</span>
            <div>
              <h2 className="head">{topic}</h2>
              {lessons.length === 0 ? (
                <p className="small">Being written.</p>
              ) : (
                <ol className={s.lessons}>
                  {lessons.map((lesson) => (
                    <li key={lesson.href}>
                      <a href={lesson.href}>{lesson.title}</a>
                      <span className="small">
                        {lesson.minutes} min{lesson.done ? ' · Done' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {deliverable && (
                <p className={s.deliverable}>
                  <a className="btn" href={deliverable.href}>
                    {deliverable.label}
                  </a>
                  <span className="small">{deliverable.detail}</span>
                </p>
              )}
              {templates.length > 0 && (
                <div className={s.templates}>
                  <h3 className="label">Templates for this module</h3>
                  <TemplateList items={templates} />
                </div>
              )}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
