/*
 * Fails if anything that must stay on the server reached the browser bundle: the explanation of any review or
 * assessment answer, which the server sends only after grading. Run after a build: pnpm check:bundle.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scripts } from "../worker/seed/catalog.ts";

const root = new URL("../.cloudflare/output/v1/workers/default/assets/", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(js|html|json|css)$/.test(name) ? [path] : [];
  });
}

const secrets = scripts.flatMap((s) => [...s.checkpoints, ...s.quiz].map((q) => ({ course: s.id, text: q.why })));
const shipped = files(root).map((path) => ({ path, text: readFileSync(path, "utf8") }));
if (shipped.length === 0) throw new Error(`No built files under ${root}. Build first.`);
const leaks = secrets.flatMap((secret) => shipped.filter((f) => f.text.includes(secret.text)).map((f) => `${secret.course}: "${secret.text.slice(0, 60)}…" in ${f.path}`));
if (leaks.length) {
  console.error(`Answers reached the browser bundle:\n${leaks.join("\n")}`);
  process.exit(1);
}
console.log(`No answer explanations in ${shipped.length} built files (${secrets.length} checked).`);
