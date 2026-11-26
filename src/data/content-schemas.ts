import { z } from 'zod';
import { wellMarked } from '../lib/marked.ts';
import { authorHandles } from './authors.ts';
import { columnSlugs } from './columns.ts';
import { coverTopics } from './cover-topics.ts';
import { programmeSlugs } from './programmes.ts';
import { RESOURCE_KINDS } from './resources.ts';
import { SESSION_KINDS } from './sessions.ts';

/*
 * The frontmatter of each kind of Markdown file the site keeps. Astro's content collections and the app's content
 * loader both validate with these, so a file the marketing site accepts is one the members' area accepts.
 */

/** Lessons are Markdown files in src/lessons/<programme>/. A lesson appears in the members' area once its file exists. */
export const lessonSchema = z.object({
  title: z.string(),
  programme: z.enum(programmeSlugs),
  /** Which of the programme's topics it belongs to, counting from 1. */
  module: z.number().int().min(1),
  order: z.number().int().min(1),
  minutes: z.number().int().positive(),
});

/** Session recordings are Markdown files in src/recordings/, one per recorded session. */
export const recordingSchema = z.object({
  title: z.string(),
  kind: z.enum(SESSION_KINDS),
  date: z.coerce.date(),
  url: z.url(),
});

/*
 * The newsletter: Markdown files in src/posts/, one per post. Essays, podcast episodes, the weekly brief and tool
 * reviews are all posts; the column says which. A post lives at /<column>/<file name>. Its topics are programmes, so
 * each programme's page lists the posts about it. A draft shows in development only.
 *
 * A post may have its own cover image. Each reader of the files resolves that image its own way, so it passes the
 * schema for it.
 */
export const postSchema = <Image extends z.ZodType>(image: Image) =>
  z.object({
    /** May mark one phrase with asterisks: "Who signs off *the AI audit*?" */
    title: z.string().refine(wellMarked, 'Mark one phrase with a pair of asterisks, or none.'),
    /** A cover topic from the brand's image system, or the post's own image made with it. Without one, the column's. */
    cover: z.union([z.enum(coverTopics), image]).optional(),
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
  });

/*
 * Templates members use with their own clients: Markdown files in src/resources/. The body is the template itself;
 * text in square brackets, like [Client name], is a placeholder the member fills in.
 */
export const resourceSchema = z.object({
  title: z.string(),
  programme: z.enum(programmeSlugs),
  /** Which of the programme's topics it belongs to, counting from 1. */
  module: z.number().int().min(1),
  kind: z.enum(RESOURCE_KINDS),
  /** One sentence on what it is for. */
  summary: z.string().max(160),
});
