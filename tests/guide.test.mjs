import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { test } from 'node:test';
import { ROOT, isGrey, read, walk } from './helpers.mjs';

const html = read('index.html');
const js = read('js/guide.js');
const cssFiles = walk('css').filter((f) => f.endsWith('.css'));

// Host photos are optional: the guide falls back to a drawn placeholder until they are added.
const OPTIONAL = /^assets\/hosts\/[\w-]+\.png$/;

const localRefs = () => {
  const refs = new Set();
  const markup = html.replace(/<pre[\s\S]*?<\/pre>/g, '');
  for (const m of markup.matchAll(/\b(?:src|href)="([^"#:]+)"/g)) refs.add(normalize(m[1]));
  for (const m of js.matchAll(/['"`](assets\/[^'"`$]+\.\w+)['"`]/g)) refs.add(normalize(m[1]));
  for (const file of cssFiles) {
    for (const m of read(file).matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      if (/^(data:|https?:|#|%23)/.test(m[1])) continue;
      refs.add(normalize(join(file, '..', m[1])));
    }
  }
  return [...refs];
};

test('every local file the guide references exists', () => {
  const missing = localRefs().filter((r) => !OPTIONAL.test(r) && !existsSync(join(ROOT, r)));
  assert.deepEqual(missing, []);
});

test('the guide loads nothing from other hosts', () => {
  assert.doesNotMatch(html, /\b(?:src|href)="https?:/, 'index.html');
  for (const file of cssFiles) assert.doesNotMatch(read(file), /url\(["']?https?:|@import url\(["']?https?:/, file);
});

test('every id the script looks up exists in the page', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...js.matchAll(/\$\('#([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(wanted.filter((id) => !ids.has(id)), []);
});

test('no grey is hardcoded in the guide or the brand layer', () => {
  // The ground test paints a deliberately busy "photo" to show misuse; those three are allowed.
  const allowed = new Set(['#c7b9a3', '#5d7d8c', '#d9c7a0']);
  for (const [name, text] of [['index.html', html], ['js/guide.js', js], ...cssFiles.map((f) => [f, read(f)])]) {
    const greys = [...text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((m) => m[0]).filter((h) => !allowed.has(h.toLowerCase()) && isGrey(h));
    assert.deepEqual(greys, [], name);
  }
});
