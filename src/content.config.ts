import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { SESSION_KINDS } from './data/sessions.ts';
import { programmeSlugs } from './data/programmes.ts';
import { RESOURCE_KINDS } from './data/resources.ts';
import { authorHandles } from './data/authors.ts';
import { columnSlugs } from './data/columns.ts';

/* Lessons are Markdown files in src/lessons/<programme>/. A lesson appears in the members' area once its file exists. */
const lessons = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/lessons' }),
  schema: z.object({
    title: z.string(),
    programme: z.enum(programmeSlugs),
    /** Which of the programme's topics it belongs to, counting from 1. */
    module: z.number().int().min(1),
    order: z.number().int().min(1),
    minutes: z.number().int().positive(),
  }),
});

/* Session recordings are Markdown files in src/recordings/, one per recorded session. */
const recordings = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/recordings' }),
  schema: z.object({
    title: z.string(),
    kind: z.enum(SESSION_KINDS),
    date: z.coerce.date(),
    url: z.url(),
  }),
});

/*
 * The newsletter: Markdown files in src/posts/, one per post. Essays, podcast episodes, the weekly brief and tool
 * reviews are all posts; the column says which. A post lives at /<column>/<file name>. Its topics are programmes, so
 * each programme's page lists the posts about it. A draft shows in development only.
 */
const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/posts' }),
  schema: z.object({
    title: z.string(),
    /** One or two sentences under the title, on the post and wherever it is listed. */
    dek: z.string().max(280),
    date: z.coerce.date(),
    column: z.enum(columnSlugs),
    authors: z.array(z.enum(authorHandles)).min(1),
    topics: z.array(z.enum(programmeSlugs)).default([]),
    /** Members-only posts show their title and dek to everyone, and the rest to members. */
    access: z.enum(['free', 'members']).default('free'),
    /** Where to watch or listen, for a podcast episode. */
    listen: z.object({ youtube: z.url().optional(), spotify: z.url().optional(), apple: z.url().optional() }).optional(),
    episode: z.number().int().positive().optional(),
    draft: z.boolean().default(false),
  }),
});

/*
 * Templates members use with their own clients: Markdown files in src/resources/. The body is the template itself;
 * text in square brackets, like [Client name], is a placeholder the member fills in.
 */
const resources = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/resources' }),
  schema: z.object({
    title: z.string(),
    programme: z.enum(programmeSlugs),
    /** Which of the programme's topics it belongs to, counting from 1. */
    module: z.number().int().min(1),
    kind: z.enum(RESOURCE_KINDS),
    /** One sentence on what it is for. */
    summary: z.string().max(160),
  }),
});

export const collections = { lessons, recordings, posts, resources };
