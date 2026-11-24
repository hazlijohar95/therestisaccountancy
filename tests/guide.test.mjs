import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { test } from 'node:test';
import { ROOT, isGrey, json, read, walk } from './helpers.mjs';

const html = read('index.html');
const js = read('guide/guide.js');
const cssFiles = [...walk('css'), 'guide/guide.css'];
const css = Object.fromEntries(cssFiles.map((f) => [f, read(f)]));
const everything = [html, js, ...Object.values(css)].join('\n');

const classesIn = (text) => new Set([...text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '').matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const markupClasses = new Set([...(html + js).matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]+)/g)].flatMap((m) => m[1].split(/[\s${}?:]+/)));
// The type ladder renders one sample per size token, classed with the token's name.
for (const size of Object.keys(json('tokens/tokens.json').size)) markupClasses.add(size);
// A class is used if it sits in a class attribute, or the script names it as a string.
const isUsed = (name) => markupClasses.has(name) || new RegExp(`['"]${name}['"]`).test(js);

const localRefs = () => {
  const refs = new Set();
  const markup = html.replace(/<pre[\s\S]*?<\/pre>/g, '');
  for (const m of markup.matchAll(/\b(?:src|href)="([^"#:]+)"/g)) refs.add(normalize(m[1]));
  for (const m of js.matchAll(/['"`]((?:assets|tokens)\/[^'"`$]+\.\w+)['"`]/g)) refs.add(normalize(m[1]));
  for (const [file, text] of Object.entries(css)) {
    for (const m of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      if (/^(data:|https?:|#|%23)/.test(m[1])) continue;
      refs.add(normalize(join(file, '..', m[1])));
    }
  }
  return [...refs];
};

test('every local file the guide references exists', () => {
  assert.deepEqual(localRefs().filter((r) => !existsSync(join(ROOT, r))), []);
});

test('the guide loads nothing from other hosts', () => {
  assert.doesNotMatch(html, /\b(?:src|href)="https?:/, 'index.html');
  for (const [file, text] of Object.entries(css)) assert.doesNotMatch(text, /url\(["']?https?:|@import url\(["']?https?:/, file);
});

test('every id the script looks up exists in the page', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...js.matchAll(/\$\('#([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(wanted.filter((id) => !ids.has(id)), []);
});

test('every class the stylesheets define is used by the guide', () => {
  for (const [file, text] of Object.entries(css)) {
    assert.deepEqual([...classesIn(text)].filter((name) => !isUsed(name)), [], `${file} styles classes the guide never shows`);
  }
});

test('every custom property that is read is set somewhere', () => {
  const set = new Set([...everything.matchAll(/(--[\w-]+)\s*:/g), ...js.matchAll(/setProperty\('(--[\w-]+)'/g)].map((m) => m[1]));
  const used = new Set([...everything.matchAll(/var\((--[\w-]+)[,)]/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((name) => !set.has(name)), []);
});

test('the masked club wordmark keeps the aspect ratio of its file', () => {
  const { aspect } = json('assets/logos/catalog.json').find((e) => e.file === 'assets/logos/tria-wordmark-mono.svg');
  assert.match(css['guide/guide.css'], new RegExp(`\\.logo-tria \\{[^}]*aspect-ratio: ${aspect};`));
});

test('no grey is hardcoded in the guide or the brand layer', () => {
  // The ground test paints a deliberately busy "photo" to show misuse; those three are allowed.
  const allowed = new Set(['#c7b9a3', '#5d7d8c', '#d9c7a0']);
  for (const [name, text] of [['index.html', html], ['guide/guide.js', js], ...Object.entries(css)]) {
    const greys = [...text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((m) => m[0]).filter((h) => !allowed.has(h.toLowerCase()) && isGrey(h));
    assert.deepEqual(greys, [], name);
  }
});

test('no stylesheet outside the token build sets a custom property that a token defines', () => {
  // A page stylesheet that reuses a token's name silently overrides it: .cells once took the guide's page gutter as its gap.
  const tokenNames = new Set([...read('css/tokens.css').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const others = { 'guide/guide.css': css['guide/guide.css'], 'css/brand.css': css['css/brand.css'], ...Object.fromEntries(walk('broadcast').filter((f) => f.endsWith('.css')).map((f) => [f, read(f)])) };
  for (const [file, text] of Object.entries(others)) {
    const set = [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
    assert.deepEqual(set.filter((name) => tokenNames.has(name)), [], file);
  }
});

test('every artboard can be exported: one b- class names its file, and a full-size button marks it', () => {
  const boards = [...html.matchAll(/class="board ([^"]+)"/g)].map((m) => m[1].split(/\s+/).filter((c) => c.startsWith('b-')));
  assert.ok(boards.length >= 10);
  assert.deepEqual(boards.filter((names) => names.length !== 1), []);
  assert.equal((html.match(/data-full>/g) || []).length, boards.length);
});
