import { createServerFn } from '@tanstack/react-start';
import { notFound } from '@tanstack/react-router';
import { z } from 'zod';
import { programmeBySlug, programmes } from '../../../src/data/programmes.ts';
import type { TemplateSummary } from '../components/members/TemplateList.tsx';
import { allResources, lessonById, lessonPath, lessonsOf, partsOf, resourceById, resourcesOf, type Resource } from '../lib/content.server.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * The programmes, their lessons and the templates. Only what a page shows leaves the server: a list carries each
 * template's title and summary, never its text.
 */

const resourcePath = (resource: Pick<Resource, 'id'>) => `/members/resources/${resource.id}`;

const summaryOf = (r: Resource): TemplateSummary => ({
  href: resourcePath(r),
  kind: r.data.kind,
  title: r.data.title,
  summary: r.data.summary,
  module: `Module ${r.data.module} · ${programmeBySlug(r.data.programme)?.topics[r.data.module - 1] ?? ''}`,
});

const completed = (memberId: number) => withStore((store) => store.club.completedLessons(memberId));

export const membersResources = createServerFn({ method: 'GET' }).handler(async () => {
  await admit('paid', toClub);
  const all = allResources();
  return programmes
    .map((programme, i) => ({ slug: programme.slug, name: programme.name, promise: programme.promise, number: String(i + 1).padStart(2, '0'), items: all.filter((r) => r.data.programme === programme.slug).map(summaryOf) }))
    .filter((group) => group.items.length > 0);
});

export const membersResource = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await admit('paid', toClub);
    const resource = resourceById(id);
    const programme = resource && programmeBySlug(resource.data.programme);
    if (!resource || !programme) throw notFound();
    const { note, body } = partsOf(resource);
    return {
      title: resource.data.title,
      summary: resource.data.summary,
      module: resource.data.module,
      topic: programme.topics[resource.data.module - 1],
      programme: { name: programme.name, href: `/members/programmes/${programme.slug}` },
      download: `${resourcePath(resource)}.md`,
      note,
      body,
    };
  });

export const membersProgramme = createServerFn({ method: 'GET' })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const member = await admit('paid', toClub);
    const programme = programmeBySlug(slug);
    if (!programme) throw notFound();
    const finished = await completed(member.id);
    const lessons = lessonsOf(programme.slug);
    const templates = resourcesOf(programme.slug);
    return {
      name: programme.name,
      promise: programme.promise,
      done: lessons.filter((l) => finished.has(l.id)).length,
      published: lessons.length,
      modules: programme.topics.map((topic, i) => ({
        topic,
        lessons: lessons.filter((l) => l.data.module === i + 1).map((l) => ({ href: lessonPath(l), title: l.data.title, minutes: l.data.minutes, done: finished.has(l.id) })),
        templates: templates.filter((t) => t.data.module === i + 1).map(summaryOf),
        deliverable: programme.deliverable?.module === i + 1 ? programme.deliverable : null,
      })),
    };
  });

export const membersLesson = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const member = await admit('paid', toClub);
    const lesson = lessonById(id);
    if (!lesson) throw notFound();
    const programme = programmeBySlug(lesson.data.programme);
    const siblings = lessonsOf(lesson.data.programme);
    const at = siblings.findIndex((l) => l.id === lesson.id);
    const link = (l: (typeof siblings)[number] | undefined) => l && { href: lessonPath(l), title: l.data.title };
    return {
      id: lesson.id,
      title: lesson.data.title,
      minutes: lesson.data.minutes,
      module: lesson.data.module,
      programme: { href: `/members/programmes/${lesson.data.programme}`, name: programme?.name, topic: programme?.topics[lesson.data.module - 1] },
      html: lesson.html,
      done: (await completed(member.id)).has(lesson.id),
      templates: resourcesOf(lesson.data.programme, lesson.data.module).map(summaryOf),
      previous: link(siblings[at - 1]),
      next: link(siblings[at + 1]),
    };
  });

const lessonDoneInput = z.object({ lesson: z.string(), done: z.boolean() });

export const lessonDone = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof lessonDoneInput>) => input)
  .handler(
    action({ access: 'paid', input: lessonDoneInput }, async ({ actor, input, store }) => {
      if (!lessonById(input.lesson)) return refused('There is no such lesson.');
      await store.club.setLessonDone(actor.id, input.lesson, input.done);
      return done({ done: input.done });
    }),
  );
