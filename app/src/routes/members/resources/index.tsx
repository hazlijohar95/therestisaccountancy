import { createFileRoute } from '@tanstack/react-router';
import { TemplateList } from '../../../components/members/TemplateList.tsx';
import { Empty } from '../../../components/ui/Empty.tsx';
import { PageHead } from '../../../components/ui/PageHead.tsx';
import { Points } from '../../../components/ui/Points.tsx';
import { Section } from '../../../components/ui/Section.tsx';
import { membersResources } from '../../../functions/members-learning.ts';
import { clubTitle } from '../../../lib/title.ts';

export const Route = createFileRoute('/members/resources/')({
  loader: () => membersResources(),
  head: () => ({ meta: clubTitle('Templates') }),
  component: Templates,
});

function Templates() {
  const groups = Route.useLoaderData();
  return (
    <>
      <PageHead
        label="Templates"
        title="Ready to use with your own clients."
        lead="Checklists, letters, scripts and worksheets, written alongside the programmes."
        aside={
          <Points
            items={[
              { icon: 'file', text: 'Copy one into Word or Google Docs' },
              { icon: 'check', text: 'Fill in everything in brackets' },
              { icon: 'users', text: 'Make it yours before a client sees it' },
            ]}
          />
        }
      />
      {groups.length === 0 ? (
        <Section title="Templates">
          <Empty icon="file">No templates yet. They appear here as each programme's are written.</Empty>
        </Section>
      ) : (
        groups.map((group) => (
          <Section key={group.slug} title={group.name} meta={<a href={`/members/programmes/${group.slug}`}>Open the programme</a>}>
            <p className="small">{group.promise}</p>
            <TemplateList items={group.items} withModule />
          </Section>
        ))
      )}
    </>
  );
}
