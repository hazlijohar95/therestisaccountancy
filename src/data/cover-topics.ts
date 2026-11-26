/*
 * The cover topics from the brand's image system (brand/imagery/covers.json). A post's cover is one of these, or its
 * own image made with the same system. Kept apart from the images because the posts collection validates against it.
 */

export const coverTopics = ['tax', 'audit', 'finance', 'data', 'ai', 'practice', 'podcast'] as const;
export type CoverTopic = (typeof coverTopics)[number];
