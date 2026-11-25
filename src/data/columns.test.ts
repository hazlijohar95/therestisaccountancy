import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { columns } from './columns.ts';
import { lines } from './lines.ts';

/* A column's page is /<slug>, beside the site's own pages. A page of the same name would hide the column. */
const topLevel = new Set(readdirSync(new URL('../pages', import.meta.url)).map((entry) => entry.replace(/\.(astro|ts)$/, '')));

test('no column is named after a page, except the podcast, whose page is its column', () => {
  const taken = columns.filter((c) => c.slug !== 'podcast' && topLevel.has(c.slug)).map((c) => c.slug);
  assert.deepEqual(taken, []);
  assert.ok(topLevel.has('podcast'));
});

test('every line in the nav has a page', () => {
  const missing = lines.filter((line) => !topLevel.has(line.href.slice(1))).map((line) => line.href);
  assert.deepEqual(missing, []);
});
