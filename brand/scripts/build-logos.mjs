#!/usr/bin/env node
// Render every logo file from the React components, so files and components can never drift.
// Usage: pnpm build:logos   (compiles first; PNGs need librsvg's rsvg-convert on PATH)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClubLogo, PodcastLogo, logoAssets } from '../dist/logo/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = { club: 'The Rest Is Accountancy', podcast: 'Stick to Accounting' };

/** The exact markup a logo file holds. Exported for the tests. */
export function renderLogo(asset) {
  const props = { variant: asset.variant, title: NAMES[asset.brand] };
  const element = asset.brand === 'club'
    ? createElement(ClubLogo, props)
    : createElement(PodcastLogo, { ...props, layout: asset.layout });
  return `${renderToStaticMarkup(element)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(join(root, 'assets/logos/png'), { recursive: true });
  const catalog = logoAssets.map((asset) => {
    const svg = renderLogo(asset);
    const file = join(root, asset.file);
    const changed = (() => { try { return readFileSync(file, 'utf8') !== svg; } catch { return true; } })();
    writeFileSync(file, svg);
    if (asset.png && changed) {
      execFileSync('rsvg-convert', ['-w', String(asset.pngSize[0]), file, '-o', join(root, asset.png)]);
    }
    return { ...asset, bytes: statSync(file).size };
  });
  writeFileSync(join(root, 'assets/logos/catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`wrote ${catalog.length} SVGs, catalog.json, and PNGs for changed files`);
}
