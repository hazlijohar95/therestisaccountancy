import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { SESSION_KINDS } from './data/sessions.ts';
import { programmeSlugs } from './data/programmes.ts';
import { RESOURCE_KINDS } from './data/resources.ts';

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
 * Podcast episodes are Markdown files in src/episodes/, one per episode. Each names the programme it leads to, so the
 * podcast page and that programme's page link the two. The file's frontmatter is all there is; the body is unused.
 */
const episodes = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/episodes' }),
  schema: z.object({
    number: z.number().int().positive(),
    title: z.string(),
    date: z.coerce.date(),
    /** Where to listen or watch: YouTube, Spotify or Apple Podcasts. */
    url: z.url(),
    /** One or two sentences on what the episode asks. */
    summary: z.string().max(280),
    programme: z.enum(programmeSlugs),
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

export const collections = { lessons, recordings, episodes, resources };
