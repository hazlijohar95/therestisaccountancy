import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { lessonSchema, postSchema, recordingSchema, resourceSchema } from './data/content-schemas.ts';

/* The schemas live in data/content-schemas.ts, shared with the app's content loader. */
const lessons = defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/lessons' }), schema: lessonSchema });
const recordings = defineCollection({ loader: glob({ pattern: '*.md', base: './src/recordings' }), schema: recordingSchema });
const posts = defineCollection({ loader: glob({ pattern: '*.md', base: './src/posts' }), schema: ({ image }) => postSchema(image()) });
const resources = defineCollection({ loader: glob({ pattern: '*.md', base: './src/resources' }), schema: resourceSchema });

export const collections = { lessons, recordings, posts, resources };
