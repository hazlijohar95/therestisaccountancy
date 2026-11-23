import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, json, read } from './helpers.mjs';

const pkg = json('package.json');

test('every export points at a file the package ships', () => {
  for (const [entry, target] of Object.entries(pkg.exports)) {
    const paths = typeof target === 'string' ? [target] : Object.values(target);
    for (const path of paths) {
      const probe = path.includes('*') ? path.slice(0, path.indexOf('*')) : path;
      assert.ok(existsSync(join(ROOT, probe)), `${entry} -> ${path}`);
      const top = probe.replace(/^\.\//, '').split('/')[0];
      assert.ok(pkg.files.includes(top), `${entry} ships from ${top}, which is not in "files"`);
    }
  }
});

test('the root entry is React-free', () => {
  const root = read('dist/index.js');
  assert.doesNotMatch(root, /from "react|logo\/logo\.js/);
});

test('src/generated/tokens.ts is exactly what the build would write', () => {
  const printed = execFileSync(process.execPath, [join(ROOT, 'scripts/build-tokens.mjs'), '--print-ts'], { encoding: 'utf8' });
  assert.equal(read('src/generated/tokens.ts'), printed, 'run: npm run build:tokens');
});

test('the public types hold their contract', () => {
  execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', join(ROOT, 'tsconfig.typetest.json')], { stdio: 'pipe' });
});

test('React is a peer, not a dependency', () => {
  assert.equal(pkg.dependencies, undefined);
  assert.ok(pkg.peerDependencies?.react);
});
