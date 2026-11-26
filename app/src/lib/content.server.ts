import ai from '@therestisaccountancy/brand/covers/ai.webp?url';
import audit from '@therestisaccountancy/brand/covers/audit.webp?url';
import data from '@therestisaccountancy/brand/covers/data.webp?url';
import finance from '@therestisaccountancy/brand/covers/finance.webp?url';
import podcast from '@therestisaccountancy/brand/covers/podcast.webp?url';
import practice from '@therestisaccountancy/brand/covers/practice.webp?url';
import tax from '@therestisaccountancy/brand/covers/tax.webp?url';
import { slug } from 'github-slugger';
import { z } from 'zod';
import { columnBySlug } from '../../../src/data/columns.ts';
import { lessonSchema, postSchema, recordingSchema, resourceSchema } from '../../../src/data/content-schemas.ts';
import type { CoverTopic } from '../../../src/data/cover-topics.ts';
import { programmeSlugs, type ProgrammeSlug } from '../../../src/data/programmes.ts';
import { templateParts, type TemplateParts } from '../../../src/lib/template.ts';
import { renderMarkdown, splitFile } from './markdown.ts';

/*
 * The site's Markdown, for the app. A Worker has no files to read, so the build bundles every file's text, and each is
 * checked against the same schema Astro uses and rendered as Astro renders it, once per Worker instance. Server only:
 * the bodies include members' lessons, templates and posts, which must never reach a browser bundle.
 */

export interface Entry<Data> {
  /** The file's path under its folder, without .md, as Astro names it. */
  readonly id: string;
  readonly data: Data;
  /** The Markdown after the frontmatter. */
  readonly body: string;
  readonly html: string;
}

type Files = Record<string, string>;

/* Vite reads each glob's options as written, so they repeat. */
const lessonFiles: Files = import.meta.glob('../../../src/lessons/**/*.md', { query: '?raw', import: 'default', eager: true });
const recordingFiles: Files = import.meta.glob('../../../src/recordings/*.md', { query: '?raw', import: 'default', eager: true });
const postFiles: Files = import.meta.glob('../../../src/posts/*.md', { query: '?raw', import: 'default', eager: true });
const resourceFiles: Files = import.meta.glob('../../../src/resources/*.md', { query: '?raw', import: 'default', eager: true });
const postImages: Files = import.meta.glob('../../../src/posts/**/*.{avif,gif,jpeg,jpg,png,webp}', { query: '?url', import: 'default', eager: true });

/** Each file in a folder, checked against the schema. A file that fails names itself, as Astro's build would. */
function load<S extends z.ZodType>(files: Files, folder: string, schema: (path: string) => S): Entry<z.output<S>>[] {
  return Object.entries(files).map(([path, text]) => {
    const relative = path.slice(path.indexOf(folder) + folder.length).replace(/\.md$/, '');
    const { frontmatter, body } = splitFile(text);
    const checked = schema(path).safeParse(frontmatter);
    if (!checked.success) throw new Error(`${folder}${relative}.md has bad frontmatter: ${z.prettifyError(checked.error)}`);
    return { id: relative.split('/').map((part) => slug(part)).join('/'), data: checked.data, body, html: renderMarkdown(body) };
  });
}

export type Lesson = Entry<z.output<typeof lessonSchema>>;
export type Resource = Entry<z.output<typeof resourceSchema>>;
export type Recording = Entry<z.output<typeof recordingSchema>>;

const lessons: readonly Lesson[] = load(lessonFiles, 'src/lessons/', () => lessonSchema).sort((a, b) => a.data.module - b.data.module || a.data.order - b.data.order);

const inPlace = (a: Resource, b: Resource) =>
  programmeSlugs.indexOf(a.data.programme) - programmeSlugs.indexOf(b.data.programme) || a.data.module - b.data.module || a.data.title.localeCompare(b.data.title);
const resources: readonly Resource[] = load(resourceFiles, 'src/resources/', () => resourceSchema).sort(inPlace);

const recordings: readonly Recording[] = load(recordingFiles, 'src/recordings/', () => recordingSchema).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

/** A programme's published lessons, in teaching order. */
export const lessonsOf = (programme: ProgrammeSlug): Lesson[] => lessons.filter((lesson) => lesson.data.programme === programme);
export const lessonById = (id: string): Lesson | undefined => lessons.find((lesson) => lesson.id === id);
export const lessonPath = (lesson: Pick<Lesson, 'id'>) => `/members/lessons/${lesson.id}`;

/** Every template, in programme order, then by module and title. */
export const allResources = (): readonly Resource[] => resources;
/** A programme's templates, or one module's when a module is given. */
export const resourcesOf = (programme: ProgrammeSlug, module?: number): Resource[] =>
  resources.filter((r) => r.data.programme === programme && (module === undefined || r.data.module === module));
export const resourceById = (id: string): Resource | undefined => resources.find((resource) => resource.id === id);
/** The note to the member and the template itself, as the template's page shows them. */
export const partsOf = (resource: Resource): TemplateParts => templateParts(resource.html);

/** Every recording, newest first. */
export const allRecordings = (): readonly Recording[] => recordings;

const covers: Record<CoverTopic, string> = { ai, audit, data, finance, podcast, practice, tax };

/** A post's own cover is a path beside its file, as Astro's image() takes it. Here it becomes the image's built address. */
const ownCover = (postPath: string) =>
  z.string().transform((relative, context) => {
    const path = new URL(relative, `file:///${postPath}`).pathname.slice(1);
    const found = Object.entries(postImages).find(([image]) => new URL(image, 'file:///').pathname.slice(1) === path);
    if (found) return found[1];
    context.addIssue({ code: 'custom', message: `No image at ${relative}` });
    return z.NEVER;
  });

const postEntries = load(postFiles, 'src/posts/', (path) => postSchema(ownCover(path)));
export type Post = (typeof postEntries)[number];

/** Drafts are for the writer's own preview. A production build never has them. */
const posts: readonly Post[] = postEntries.filter((post) => !(import.meta.env.PROD && post.data.draft));

export const postAt = (column: string, id: string): Post | undefined => posts.find((post) => post.data.column === column && post.id === id);

const isTopic = (value: string): value is CoverTopic => value in covers;

/** The image a post opens with: its own, or its cover topic's, or its column's. */
export function coverOf(post: Post): string {
  const own = post.data.cover;
  if (own === undefined) return covers[columnBySlug(post.data.column)?.cover ?? 'practice'];
  return isTopic(own) ? covers[own] : own;
}
