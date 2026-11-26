import { createFileRoute } from '@tanstack/react-router';
import { Masthead } from '../../../components/club/Masthead.tsx';
import { TemplateList } from '../../../components/members/TemplateList.tsx';
import { membersResources } from '../../../functions/members-learning.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './index.module.css';

export const Route = createFileRoute('/members/resources/')({
  loader: () => membersResources(),
  head: () => ({ meta: clubTitle('Templates') }),
  component: Templates,
});

function Templates() {
  const groups = Route.useLoaderData();
  return (
    <>
      <Masthead label="Templates" title="Ready to use with your own clients." narrow>
        <p>Checklists, letters, scripts and worksheets, written alongside the programmes. Copy one into Word or Google Docs, fill in everything in brackets, and make it yours before a client sees it.</p>
      </Masthead>
      <section className={`wrap ${s.library}`} aria-label="Templates by programme">
        {groups.length === 0 ? (
          <p className={s.empty}>No templates yet. They appear here as each programme's are written.</p>
        ) : (
          groups.map((group) => (
            <section key={group.slug} className={s.group} aria-labelledby={`t-${group.slug}`}>
              <div className={s.rail}>
                <span className={`serif ${s.n}`}>{group.number}</span>
                <div>
                  <h2 className="head" id={`t-${group.slug}`}>
                    {group.name}
                  </h2>
                  <p className="small">
                    {group.promise} <a href={`/members/programmes/${group.slug}`}>Open the programme</a>
                  </p>
                </div>
              </div>
              <TemplateList items={group.items} withModule />
            </section>
          ))
        )}
      </section>
    </>
  );
}
