import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { programmeBySlug, programmeSlugs } from '../data/programmes.ts';
import { RESOURCE_KINDS } from '../data/resources.ts';

/* The templates as files: node:test cannot load astro:content, and the files are what a host edits. */
const folder = new URL('../resources/', import.meta.url);
const templates = readdirSync(folder)
  .filter((file) => file.endsWith('.md'))
  .map((file) => {
    const [, head = '', body = ''] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(new URL(file, folder), 'utf8')) ?? [];
    const field = (key: string) => new RegExp(`^${key}: (.*)$`, 'm').exec(head)?.[1]?.trim() ?? '';
    const lines = body.trimStart().split('\n');
    const template = lines.slice(Math.max(lines.findIndex((line) => !line.startsWith('>')), 0)).join('\n');
    return { file, title: field('title'), programme: field('programme'), module: Number(field('module')), kind: field('kind'), summary: field('summary'), body, template };
  });

/** Text in square brackets with a letter in it, and not a link's text. */
const PLACEHOLDER = /\[[^\[\]\n]*\p{L}[^\[\]\n]*\](?!\()/u;

/** What a template must not state as fact. The member puts in their own terms and has them checked. */
const REGULATORY = [
  /\bAct\b/,
  /\b(section|subsection|regulation|rule|paragraph) \d/i,
  /\b(LHDN|HASiL|IRBM?|SSM|MIA|MICPA|CTIM|ACCA|MACC|BNM|AMLA|PDPA|SST|GST|MPERS|MFRS|IFRS|EPF|KWSP|SOCSO|PERKESO|MyInvois|CP204|CP58)\b/,
  /Inland Revenue|Companies Commission|Bank Negara|Securities Commission|Personal Data Protection|Institute of Accountants/i,
  /\bForm [A-Z]\b/,
  /\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\b/,
];

test('there are templates to test', () => {
  assert.ok(templates.length >= 14, `${templates.length} templates`);
});

test('every template sits in a module its programme has, as a kind the library knows', () => {
  for (const t of templates) {
    const programme = programmeBySlug(t.programme);
    assert.ok(programme, `${t.file}: no programme ${t.programme}`);
    assert.ok(Number.isInteger(t.module) && t.module >= 1 && t.module <= programme.topics.length, `${t.file}: ${programme.name} has no module ${t.module}`);
    assert.ok(RESOURCE_KINDS.some((kind) => kind === t.kind), `${t.file}: no kind ${t.kind}`);
  }
});

test('every programme has templates', () => {
  const covered = new Set(templates.map((t) => t.programme));
  assert.deepEqual(programmeSlugs.filter((slug) => !covered.has(slug)), []);
});

test('titles are unique and every summary is one short sentence', () => {
  assert.equal(new Set(templates.map((t) => t.title)).size, templates.length);
  for (const t of templates) {
    assert.ok(t.summary.length > 0 && t.summary.length <= 160, `${t.file}: summary is ${t.summary.length} characters`);
    assert.match(t.summary, /^[^.]+\.$/, `${t.file}: summary is not one sentence`);
  }
});

test('every template has something for the member to fill in', () => {
  for (const t of templates) assert.match(t.template, PLACEHOLDER, `${t.file}: no [placeholder]`);
});

test('what goes to a client links nowhere on this site and has no code blocks', () => {
  for (const t of templates) {
    assert.doesNotMatch(t.template, /\]\(\//, `${t.file}: a site link in the template`);
    assert.doesNotMatch(t.body, /```/, `${t.file}: a code block`);
  }
});

test('templates state no law, body, form, threshold or deadline', () => {
  for (const t of templates) {
    for (const pattern of REGULATORY) assert.doesNotMatch(`${t.title}\n${t.summary}\n${t.body}`, pattern, `${t.file}: ${pattern}`);
  }
});

test('templates keep the house style for money and punctuation', () => {
  for (const t of templates) {
    const text = `${t.title}\n${t.summary}\n${t.body}`;
    assert.doesNotMatch(text, /RM\d|MYR|RM\s*\d+(\.\d+)?k\b/, `${t.file}: money is written RM 1,234`);
    assert.doesNotMatch(text, /!|—|\s--\s/, `${t.file}: no exclamation marks or dashes`);
  }
});
