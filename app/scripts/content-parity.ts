/*
 * Checks the app's Markdown rendering against Astro's. Astro keeps every entry it loaded, rendered, in its data store;
 * this renders the same files with the app's renderer and schemas and prints every difference.
 *
 *   npx astro sync && node --import tsx app/scripts/content-parity.ts
 *
 * Run from the repository root. Exits 1 on any difference.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { lessonSchema, postSchema, recordingSchema, resourceSchema } from '../../src/data/content-schemas.ts';
import { renderMarkdown, splitFile } from '../src/lib/markdown.ts';

const astro = createRequire(realpathSync('node_modules/astro/package.json'));
const devalue: { unflatten: (value: unknown) => unknown } = await import(astro.resolve('devalue'));
const stored = devalue.unflatten(JSON.parse(readFileSync('node_modules/.astro/data-store.json', 'utf8')));

const entry = z.object({ data: z.record(z.string(), z.unknown()), body: z.string(), filePath: z.string(), rendered: z.object({ html: z.string() }) });
const schemas: Record<string, z.ZodType> = { lessons: lessonSchema, recordings: recordingSchema, posts: postSchema(z.string()), resources: resourceSchema };

let differences = 0;
let checked = 0;
for (const [collection, entries] of z.map(z.string(), z.map(z.string(), z.unknown())).parse(stored)) {
  const schema = schemas[collection];
  if (!schema) continue;
  for (const [id, value] of entries) {
    const astroEntry = entry.parse(value);
    const { frontmatter, body } = splitFile(readFileSync(astroEntry.filePath, 'utf8'));
    const ours = { html: renderMarkdown(body), data: JSON.stringify(schema.parse(frontmatter)) };
    const theirs = { html: astroEntry.rendered.html.trimEnd(), data: JSON.stringify(astroEntry.data) };
    checked++;
    if (ours.data !== theirs.data) {
      differences++;
      console.log(`${collection}/${id}: frontmatter differs\n  app:   ${ours.data}\n  astro: ${theirs.data}`);
    }
    if (body !== astroEntry.body) {
      differences++;
      console.log(`${collection}/${id}: Markdown body differs`);
    }
    if (ours.html !== theirs.html) {
      differences++;
      const a = ours.html.split('\n');
      const b = theirs.html.split('\n');
      const line = a.findIndex((text, i) => text !== b[i]);
      console.log(`${collection}/${id}: HTML differs at line ${line + 1}\n  app:   ${a[line]}\n  astro: ${b[line]}`);
    }
  }
}
console.log(`${checked} entries checked, ${differences} differences.`);
process.exit(differences ? 1 : 0);
