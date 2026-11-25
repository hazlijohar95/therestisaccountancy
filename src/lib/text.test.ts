import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paragraphs, pieces } from './text.ts';

test('blank lines split paragraphs; single line breaks stay inside one', () => {
  assert.deepEqual(paragraphs('one\nstill one\n\n  \n\ntwo'), ['one\nstill one', 'two']);
  assert.deepEqual(paragraphs('   '), []);
});

test('http and https addresses become links, without the sentence punctuation after them', () => {
  assert.deepEqual(pieces('See https://lhdn.gov.my/guide. Or (http://x.my/a?b=1).'), [
    { kind: 'text', text: 'See ' },
    { kind: 'link', text: 'https://lhdn.gov.my/guide', href: 'https://lhdn.gov.my/guide' },
    { kind: 'text', text: '. Or (' },
    { kind: 'link', text: 'http://x.my/a?b=1', href: 'http://x.my/a?b=1' },
    { kind: 'text', text: ').' },
  ]);
});

test('a closing parenthesis stays when it belongs to the address', () => {
  assert.deepEqual(pieces('https://en.wikipedia.org/wiki/Accrual_(accounting).'), [
    { kind: 'link', text: 'https://en.wikipedia.org/wiki/Accrual_(accounting)', href: 'https://en.wikipedia.org/wiki/Accrual_(accounting)' },
    { kind: 'text', text: '.' },
  ]);
});

test('nothing else becomes a link, and markup stays text', () => {
  assert.deepEqual(pieces('javascript:alert(1) <b>hi</b> www.example.com'), [{ kind: 'text', text: 'javascript:alert(1) <b>hi</b> www.example.com' }]);
});
