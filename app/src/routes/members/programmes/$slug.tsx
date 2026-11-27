import { createFileRoute } from '@tanstack/react-router';
import { TemplateList } from '../../../components/members/TemplateList.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { List, Meta, Row } from '../../../components/ui/List.tsx';
import { PageHead } from '../../../components/ui/PageHead.tsx';
import { Actions, Section } from '../../../components/ui/Section.tsx';
import { Progress } from '../../../components/ui/Steps.tsx';
import { membersProgramme } from '../../../functions/members-learning.ts';
import { clubTitle } from '../../../lib/title.ts';

export const Route = createFileRoute('/members/programmes/$slug')({
  loader: ({ params }) => membersProgramme({ data: params.slug }),
  head: ({ loaderData }) => ({ meta: clubTitle(loaderData?.name) }),
  component: Programme,
});

function Programme() {
  const programme = Route.useLoaderData();
  return (
    <>
      <PageHead
        label={
          <span>
            <a href="/members">Overview</a> / Programme
          </span>
        }
        title={programme.name}
        lead={programme.promise}
        aside={programme.published > 0 ? <Progress value={programme.done} max={programme.published} label="Published lessons done" /> : <Badge>Lessons being written</Badge>}
      />
      {programme.modules.map(({ topic, lessons, templates, deliverable }, i) => {
        const done = lessons.filter((lesson) => lesson.done).length;
        return (
          <Section
            key={topic}
            title={topic}
            meta={
              <>
                <span className="label">Module {i + 1}</span>
                {lessons.length === 0 ? <Badge>Being written</Badge> : <Badge tone={done === lessons.length ? 'solid' : 'plain'}>{done === lessons.length ? 'Done' : `${done} of ${lessons.length} done`}</Badge>}
              </>
            }
          >
            {lessons.length > 0 && (
              <List ordered>
                {lessons.map((lesson) => (
                  <Row
                    key={lesson.href}
                    title={<a href={lesson.href}>{lesson.title}</a>}
                    meta={<Meta icon="clock">{lesson.minutes} min</Meta>}
                    trail={lesson.done && <Badge tone="solid">Done</Badge>}
                  />
                ))}
              </List>
            )}
            {deliverable && (
              <Actions>
                <a className="btn" href={deliverable.href}>
                  {deliverable.label}
                </a>
                <span className="small">{deliverable.detail}</span>
              </Actions>
            )}
            {templates.length > 0 && <TemplateList items={templates} />}
          </Section>
        );
      })}
    </>
  );
}
