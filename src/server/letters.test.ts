import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asHtml, asText } from './letters.ts';

test('typed text is escaped and never becomes a link', () => {
  const html = asHtml('Visit https://evil.example <b>now</b>');
  assert.equal(html, '<p>Visit https://evil.example &#60;b&#62;now&#60;/b&#62;</p>');
  assert.ok(!html.includes('<a '));
});

test('a link the club built is clickable in HTML and plain in text', () => {
  const line = { href: 'https://better-accountant.com/welcome?token=a&b' };
  assert.equal(asHtml(line), '<p><a href="https://better-accountant.com/welcome?token=a&#38;b">https://better-accountant.com/welcome?token=a&#38;b</a></p>');
  assert.equal(asText(line), 'https://better-accountant.com/welcome?token=a&b');
});
