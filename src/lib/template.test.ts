import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markPlaceholders, templateParts } from './template.ts';

test('marks every placeholder in the text', () => {
  assert.equal(markPlaceholders('<p>Dear [Client name], your fee is RM [Fee] a month.</p>'), '<p>Dear <mark>[Client name]</mark>, your fee is RM <mark>[Fee]</mark> a month.</p>');
});

test('leaves tags, attributes and links alone', () => {
  const html = '<p><a href="/tools/rate?x=[a]" title="[Title]">rate tool</a> and [Your booking link]</p>';
  assert.equal(markPlaceholders(html), '<p><a href="/tools/rate?x=[a]" title="[Title]">rate tool</a> and <mark>[Your booking link]</mark></p>');
});

test('does not mark an empty box, a number or brackets that span a tag', () => {
  for (const html of ['<p>[ ] to do</p>', '<p>See note [1].</p>', '<p>[Client <strong>name</strong>]</p>']) {
    assert.equal(markPlaceholders(html), html);
  }
});

test('a template that opens with a quote has a note to the member, kept out of the template', () => {
  const html = '<blockquote>\n<p>Send it to [Client name] before the call.</p>\n</blockquote>\n<h2 id="agenda">Agenda</h2>\n<p>Dear [Client name],</p>\n';
  const parts = templateParts(html);
  assert.equal(parts.note, '<p>Send it to <mark>[Client name]</mark> before the call.</p>');
  assert.equal(parts.body, '<h2 id="agenda">Agenda</h2>\n<p>Dear <mark>[Client name]</mark>,</p>');
});

test('a template without an opening quote is all template, and a later quote stays in it', () => {
  const html = '<h2>Prompts</h2>\n<blockquote>\n<p>Summarise [Document].</p>\n</blockquote>\n';
  const parts = templateParts(html);
  assert.equal(parts.note, null);
  assert.equal(parts.body, '<h2>Prompts</h2>\n<blockquote>\n<p>Summarise <mark>[Document]</mark>.</p>\n</blockquote>');
});
