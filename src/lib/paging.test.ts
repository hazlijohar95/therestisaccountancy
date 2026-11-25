import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageCount, pageHref, pagingOf } from './paging.ts';

test('a page number that is missing, zero, negative or not a whole number reads as page one', () => {
  for (const raw of ['', '0', '-2', '1.5', 'two']) assert.equal(pagingOf(new URL(`http://x/a?page=${raw}`), 30).page, 1, raw);
  assert.deepEqual(pagingOf(new URL('http://x/a?page=3'), 30), { page: 3, size: 30, offset: 60 });
  assert.equal(pagingOf(new URL('http://x/a?page=1000000000000000000'), 50).page, 1_000_000, 'a huge page is capped, not passed to SQLite');
});

test('page links keep the search, drop form actions, and leave page one bare', () => {
  const url = new URL('http://x/admin?q=aina&page=2&_action=newLink');
  assert.equal(pageHref(url, 3), '/admin?q=aina&page=3');
  assert.equal(pageHref(url, 1), '/admin?q=aina');
  assert.equal(pageCount(0, 30), 1);
  assert.equal(pageCount(61, 30), 3);
});
