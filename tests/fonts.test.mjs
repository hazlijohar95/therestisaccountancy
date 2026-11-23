import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, json, read } from './helpers.mjs';

const css = read('css/fonts.css');
const faces = [...css.matchAll(/@font-face \{([^}]+)\}/g)].map((m) => m[1]);

test('every font face points at a bundled woff2', () => {
  assert.ok(faces.length > 0);
  for (const face of faces) {
    const url = face.match(/url\(([^)]+)\)/)[1];
    assert.match(url, /^\.\.\/assets\/fonts\/[\w-]+\.woff2$/);
    assert.ok(existsSync(join(ROOT, 'css', url)), url);
    assert.match(face, /unicode-range:/, `${url} needs a unicode-range`);
    assert.match(face, /font-display: swap/, `${url} needs font-display: swap`);
  }
});

test('every brand typeface has a bundled face', () => {
  const families = new Set(faces.map((f) => f.match(/font-family: '([^']+)'/)[1]));
  const tokens = json('tokens/tokens.json');
  for (const [role, entry] of Object.entries(tokens.font)) {
    const first = entry.$value.match(/'([^']+)'/)[1];
    assert.ok(families.has(first), `${role} font ${first} is not bundled`);
  }
});

test('brand.css loads the bundled fonts, not a CDN', () => {
  const brand = read('css/brand.css');
  assert.match(brand, /@import url\("fonts\.css"\)/);
  assert.doesNotMatch(brand, /fonts\.googleapis\.com/);
});
