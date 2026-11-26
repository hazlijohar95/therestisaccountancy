/* The cover images. A post without its own cover takes its column's. */
import type { ImageMetadata } from 'astro';
import ai from '@therestisaccountancy/brand/covers/ai.webp';
import audit from '@therestisaccountancy/brand/covers/audit.webp';
import data from '@therestisaccountancy/brand/covers/data.webp';
import finance from '@therestisaccountancy/brand/covers/finance.webp';
import podcast from '@therestisaccountancy/brand/covers/podcast.webp';
import practice from '@therestisaccountancy/brand/covers/practice.webp';
import tax from '@therestisaccountancy/brand/covers/tax.webp';
import type { Post } from '../server/posts.ts';
import type { CoverTopic } from './cover-topics.ts';
import { columnBySlug } from './columns.ts';

export const covers: Record<CoverTopic, ImageMetadata> = { ai, audit, data, finance, podcast, practice, tax };

export function coverOf(post: Post): ImageMetadata {
  const own = post.data.cover;
  if (own === undefined) return covers[columnBySlug(post.data.column)?.cover ?? 'practice'];
  return typeof own === 'string' ? covers[own] : own;
}
