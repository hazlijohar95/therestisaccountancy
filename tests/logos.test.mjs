import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, pngSize, read, size, walk } from './helpers.mjs';

const catalog = json('assets/logos/catalog.json');
const svgs = walk('assets/logos').filter((f) => f.endsWith('.svg'));
const { ink, paper, tape } = json('tokens/tokens.json').color;
const PALETTE_FILLS = new Set([ink, paper, tape].map((c) => c.$value));
const MAX_SVG = 80 * 1024;

test('the catalog lists every logo file, and only those', () => {
  assert.deepEqual(catalog.map((e) => e.file).sort(), svgs.sort());
});

test('every brand ships all three variants of every layout', () => {
  const keys = new Set(catalog.map((e) => `${e.brand}/${e.layout}/${e.variant}`));
  for (const e of catalog) for (const v of ['color', 'reversed', 'mono']) assert.ok(keys.has(`${e.brand}/${e.layout}/${v}`), `${e.brand} ${e.layout} is missing ${v}`);
});

for (const file of svgs) {
  test(`${file} is a clean, safe, tight vector`, () => {
    const svg = read(file);
    assert.equal((svg.match(/<svg\b/g) || []).length, 1, 'one root <svg>');
    const rootTag = svg.slice(0, svg.indexOf('>') + 1);
    assert.match(rootTag, /viewBox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/, 'a numeric viewBox');
    assert.doesNotMatch(rootTag, /\s(width|height)=/, 'no intrinsic size on the root');
    assert.match(rootTag, /aria-label="[^"]+"/, 'an accessible name');
    assert.doesNotMatch(svg, /<(image|script|style|filter|mask|clipPath|use|foreignObject|text)\b/i, 'paths only');
    assert.doesNotMatch(svg, /\s(on\w+|id|class|style|transform)=/i, 'no ids, classes, inline styles, handlers or transforms');
    assert.doesNotMatch(svg, /javascript:|data:/i, 'no embedded data');
    const fills = new Set([...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]));
    for (const f of fills) assert.ok(PALETTE_FILLS.has(f) || f === 'currentColor', `off-palette fill ${f}`);
    if (file.includes('-mono')) assert.deepEqual([...fills], ['currentColor'], 'mono draws only in currentColor');
    assert.ok(size(file) <= MAX_SVG, `${size(file)} bytes is over the ${MAX_SVG} budget`);
  });
}

test('every non-mono logo has a PNG at the size the catalog states', () => {
  for (const e of catalog) {
    if (e.variant === 'mono') { assert.equal(e.png, undefined); continue; }
    assert.deepEqual(pngSize(e.png), e.pngSize, e.png);
    const [w, h] = e.pngSize;
    assert.ok(Math.abs(w / h - e.aspect) / e.aspect < 0.005, `${e.png} aspect drifts from its SVG`);
  }
});

test('the catalog byte counts match the files', () => {
  for (const e of catalog) assert.equal(e.bytes, size(e.file), e.file);
});

test('all assets stay under 3 MB', () => {
  const total = walk('assets').reduce((sum, f) => sum + size(f), 0);
  assert.ok(total < 3 * 1024 * 1024, `assets/ is ${Math.round(total / 1024)} KB`);
});
