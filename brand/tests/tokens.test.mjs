import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, isGrey, json, read } from './helpers.mjs';

const tokens = json('tokens/tokens.json');
const palette = Object.fromEntries(Object.entries(tokens.color).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.$value]));
const resolve = (ref) => palette[ref];
const brands = Object.entries(tokens.theme).filter(([k]) => !k.startsWith('$'));

test('every palette colour is a six-digit hex with a description', () => {
  for (const [name, entry] of Object.entries(tokens.color)) {
    if (name.startsWith('$')) continue;
    assert.match(entry.$value, /^#[0-9A-F]{6}$/, name);
    assert.ok(entry.$description?.length > 10, `${name} needs a description`);
  }
});

test('every theme role resolves, in both brands and both modes', () => {
  const roles = Object.keys(brands[0][1]);
  for (const [brand, map] of brands) {
    assert.deepEqual(Object.keys(map).sort(), [...roles].sort(), `${brand} defines a different set of roles`);
    for (const [role, pair] of Object.entries(map)) {
      assert.equal(pair.length, 2, `${brand}.${role} needs [light, dark]`);
      for (const ref of pair) assert.ok(resolve(ref), `${brand}.${role} -> ${ref} is not a palette colour`);
    }
  }
});

test('no theme role is grey', () => {
  for (const [brand, map] of brands) {
    for (const [role, pair] of Object.entries(map)) {
      for (const ref of pair) assert.equal(isGrey(resolve(ref)), false, `${brand}.${role} resolves to grey ${resolve(ref)}`);
    }
  }
});

test('the contrast contract passes', () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-tokens.mjs'), '--check'], { stdio: 'pipe' });
});

test('css/tokens.css is exactly what the build would write', () => {
  const printed = execFileSync(process.execPath, [join(ROOT, 'scripts/build-tokens.mjs'), '--print'], { encoding: 'utf8' });
  assert.equal(read('css/tokens.css'), printed, 'run: pnpm build:tokens');
});

test('every per-brand style token is defined for both brands', () => {
  assert.deepEqual(Object.keys(tokens.style.club).sort(), Object.keys(tokens.style.podcast).sort());
});
