import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const read = (path) => readFileSync(join(ROOT, path), 'utf8');
export const json = (path) => JSON.parse(read(path));

export const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((name) => {
  const path = join(dir, name);
  if (name.startsWith('.')) return [];
  return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
});

export const size = (path) => statSync(join(ROOT, path)).size;
export const rel = (abs) => relative(ROOT, abs);

/** A mid-tone with no hue: what the brand rules out. Ink (#231F20) and black/white pass. */
export const isGrey = (hex) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, hex.slice(-1)).slice(0, 6), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return Math.max(r, g, b) - Math.min(r, g, b) < 14 && r > 45 && r < 235;
};

/** Width and height from a PNG's IHDR chunk. */
export const pngSize = (path) => {
  const buf = readFileSync(join(ROOT, path));
  if (buf.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};
