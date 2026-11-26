import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embedAddress, youtubeId } from './youtube.ts';

test('a video ID comes out of every usual YouTube address', () => {
  for (const address of [
    'https://www.youtube.com/watch?v=XzAwU4tnJKQ',
    'https://youtube.com/watch?v=XzAwU4tnJKQ&t=42s',
    'https://m.youtube.com/watch?v=XzAwU4tnJKQ',
    'https://youtu.be/XzAwU4tnJKQ?si=abc',
    'https://www.youtube.com/embed/XzAwU4tnJKQ',
    'https://www.youtube.com/shorts/XzAwU4tnJKQ',
    'https://www.youtube.com/live/XzAwU4tnJKQ',
  ]) assert.equal(youtubeId(address), 'XzAwU4tnJKQ', address);
});

test('an address that is not a YouTube video gives no ID', () => {
  for (const address of ['https://www.youtube.com/@TheRestIsAccountancy', 'https://evil.example/watch?v=XzAwU4tnJKQ', 'https://youtu.be/short', 'not a url', 'https://www.youtube.com/watch?v=XzAwU4tnJKQ"><script>'])
    assert.equal(youtubeId(address), undefined, address);
});

test('the embed sets no cookies until played', () => {
  assert.equal(embedAddress('XzAwU4tnJKQ'), 'https://www.youtube-nocookie.com/embed/XzAwU4tnJKQ?autoplay=1&rel=0');
});
