import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { test } from 'node:test';
import { DEFAULTS, LAYOUTS, SEGMENTS, STAGES, marked, parse, runs, serialize, tickerItem } from '../broadcast/state.js';
import { ROOT, isGrey, read, walk } from './helpers.mjs';

const files = Object.fromEntries(walk('broadcast').map((f) => [f, read(f)]));

test('an overlay URL round-trips, and carries only what differs from the defaults', () => {
  const state = { ...DEFAULTS, view: 'card', segment: 'interview', guest: 'A & B', headline: 'Is 2 > 1, *really*?' };
  assert.deepEqual(parse(`#${serialize(state)}`), state);
  assert.equal(serialize(DEFAULTS), '');
  assert.deepEqual([...new URLSearchParams(serialize(state)).keys()], ['view', 'segment', 'headline', 'guest']);
});

test('an overlay URL cannot select a view, layout, segment or mode that does not exist', () => {
  const state = parse('#view=nope&layout=9up&segment=sport&mode=loud&status=maybe&unknown=1');
  assert.deepEqual(state, DEFAULTS);
});

test('every camera window sits inside the show stage and none overlap', () => {
  const { W, H } = STAGES.show;
  for (const [name, { cams }] of Object.entries(LAYOUTS)) {
    cams.forEach(([x, y, w, h], i) => {
      assert.ok(x >= 0 && y >= 0 && x + w <= W && y + h <= H, `${name} window ${i} leaves the stage`);
      for (const [x2, y2, w2, h2] of cams.slice(i + 1)) assert.ok(x + w <= x2 || x2 + w2 <= x || y + h <= y2 || y2 + h2 <= y, `${name} windows overlap`);
    });
  }
});

test('every segment has a ground the lower third styles', () => {
  const css = files['broadcast/overlay.css'];
  for (const [name, { ground }] of Object.entries(SEGMENTS)) assert.ok(ground === 'paper' || css.includes(`[data-ground="${ground}"]`), name);
});

test('typed text cannot inject markup; asterisks mark; figures in brackets and timecodes are tagged', () => {
  assert.equal(marked('<b>a</b> *b*'), '&lt;b&gt;a&lt;/b&gt; <span class="mark">b</span>');
  assert.deepEqual(runs('Who signs the *AI audit*?'), [{ text: 'Who signs the ', mark: false }, { text: 'AI audit', mark: true }, { text: '?', mark: false }]);
  assert.equal(tickerItem('Write-offs (3,150)'), 'Write-offs <span class="neg">3,150</span>');
  assert.equal(tickerItem(' Ep. 44 <i> 41:02 '), 'Ep. 44 &lt;i&gt; <span class="tc">41:02</span>');
});

test('every local file the broadcast kit references exists, and nothing loads from another host', () => {
  const refs = new Set();
  for (const [file, text] of Object.entries(files)) {
    assert.doesNotMatch(text, /(?:src|href)="https?:|url\(["']?https?:|from ['"]https?:/, file);
    const found = [...text.matchAll(/\b(?:src|href)="([^"#:$]+)"/g), ...text.matchAll(/['"`]((?:\.\.?\/)[^'"`$]+\.\w+)['"`]/g), ...text.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
    for (const [, ref] of found) if (!/^data:/.test(ref)) refs.add(normalize(join(file, '..', ref)));
  }
  assert.ok(refs.size > 10);
  assert.deepEqual([...refs].filter((ref) => !existsSync(join(ROOT, ref))), []);
});

test('no grey is hardcoded in the broadcast kit', () => {
  for (const [file, text] of Object.entries(files)) {
    assert.deepEqual([...text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((m) => m[0]).filter(isGrey), [], file);
  }
});
