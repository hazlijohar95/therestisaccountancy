import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { coverTopics } from './cover-topics.ts';

test('the cover topics are exactly the brand image system’s topics', () => {
  const system: unknown = JSON.parse(readFileSync(new URL('../../brand/imagery/covers.json', import.meta.url), 'utf8'));
  const topics = typeof system === 'object' && system !== null && 'topics' in system && typeof system.topics === 'object' && system.topics !== null ? Object.keys(system.topics) : [];
  assert.deepEqual([...coverTopics].sort(), topics.sort());
});
