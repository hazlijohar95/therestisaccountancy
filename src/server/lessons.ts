import { getCollection, type CollectionEntry } from 'astro:content';
import type { ProgrammeSlug } from '../data/programmes.ts';

export type Lesson = CollectionEntry<'lessons'>;

/** A programme's published lessons, in teaching order. */
export async function lessonsOf(programme: ProgrammeSlug): Promise<Lesson[]> {
  const lessons = await getCollection('lessons', (lesson) => lesson.data.programme === programme);
  return lessons.sort((a, b) => a.data.module - b.data.module || a.data.order - b.data.order);
}

export const lessonPath = (lesson: Pick<Lesson, 'id'>) => `/members/lessons/${lesson.id}`;
