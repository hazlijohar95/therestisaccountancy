import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClubLogo, PodcastLogo, logoAssets } from '../dist/logo/index.js';
import { renderLogo } from '../scripts/build-logos.mjs';
import { read } from './helpers.mjs';

const html = (component, props = {}) => renderToStaticMarkup(createElement(component, props));
const fills = (markup) => [...markup.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);

test('every logo file is exactly what its component renders', () => {
  for (const asset of logoAssets) assert.equal(read(asset.file), renderLogo(asset), `${asset.file}: run npm run build:logos`);
});

test('without a title the logo is decorative; with one it is a named image', () => {
  const plain = html(ClubLogo);
  assert.match(plain, /aria-hidden="true"/);
  assert.doesNotMatch(plain, /role=/);
  const named = html(ClubLogo, { title: 'The Rest Is Accountancy' });
  assert.match(named, /role="img"/);
  assert.match(named, /aria-label="The Rest Is Accountancy"/);
  assert.doesNotMatch(named, /aria-hidden/);
});

test('size sets the width only, so the aspect ratio holds', () => {
  const markup = html(PodcastLogo, { size: 240 });
  assert.match(markup, /width="240"/);
  assert.doesNotMatch(markup, /height=/);
});

test('colour variants use the palette; mono uses currentColor or the given colour', () => {
  assert.deepEqual(new Set(fills(html(ClubLogo))), new Set(['#231F20']));
  assert.deepEqual(new Set(fills(html(ClubLogo, { variant: 'reversed' }))), new Set(['#FFFFFF']));
  assert.deepEqual(new Set(fills(html(ClubLogo, { variant: 'mono' }))), new Set(['currentColor']));
  assert.deepEqual(new Set(fills(html(ClubLogo, { variant: 'mono', color: '#A8180F' }))), new Set(['#A8180F']));
  assert.deepEqual(new Set(fills(html(PodcastLogo, { variant: 'reversed' }))), new Set(['#F7D52A', '#231F20', '#FFFFFF']));
});

test('podcast mono cuts "Podcast Show" out of the tape in one even-odd shape', () => {
  const markup = html(PodcastLogo, { variant: 'mono' });
  assert.equal((markup.match(/fill-rule="evenodd"/g) || []).length, 1);
  assert.ok(!fills(markup).includes('#F7D52A'));
});

test('layouts add and drop the right parts', () => {
  const count = (props) => (html(PodcastLogo, props).match(/<path/g) || []).length;
  const lockup = count({ layout: 'lockup' });
  const tagline = count({ layout: 'tagline' });
  const wordmark = count({ layout: 'wordmark' });
  assert.ok(wordmark < lockup && lockup < tagline, `${wordmark} < ${lockup} < ${tagline}`);
  assert.ok(!fills(html(PodcastLogo, { layout: 'wordmark' })).includes('#F7D52A'), 'wordmark has no tape');
});

test('extra SVG props pass through', () => {
  const markup = html(PodcastLogo, { className: 'logo', 'data-testid': 'sta', focusable: 'false' });
  assert.match(markup, /class="logo"/);
  assert.match(markup, /data-testid="sta"/);
});
