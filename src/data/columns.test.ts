import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { columns } from './columns.ts';
import { lines, menu } from './lines.ts';

/*
 * A column's page is /<slug>, beside the site's own pages: Astro's static ones and the app's routes. A page of the same
 * name would hide the column.
 */
const namesIn = (dir: string) => readdirSync(new URL(dir, import.meta.url)).map((entry) => entry.replace(/\.(astro|ts|tsx)$/, ''));
const topLevel = new Set([...namesIn('../pages'), ...namesIn('../../app/src/routes')]);

test('no column is named after a page, except the podcast, whose page is its column', () => {
  const taken = columns.filter((c) => c.slug !== 'podcast' && topLevel.has(c.slug)).map((c) => c.slug);
  assert.deepEqual(taken, []);
  assert.ok(topLevel.has('podcast'));
});

test('every line in the nav has a page', () => {
  const missing = lines.filter((line) => !topLevel.has(line.href.slice(1))).map((line) => line.href);
  assert.deepEqual(missing, []);
});

test('every page the menu links to exists', () => {
  const pages = [...menu.primary, ...menu.secondary].map((link) => link.href).filter((href) => href.startsWith('/'));
  const missing = pages.filter((href) => !topLevel.has(href.slice(1).split('#')[0] || 'index'));
  assert.deepEqual(missing, []);
});
