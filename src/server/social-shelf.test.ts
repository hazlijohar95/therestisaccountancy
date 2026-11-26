import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY, reason, socialWorld, value } from './social-fixtures.ts';
import { publicLink } from './social-shelf.ts';

test('a shelf link is https, with a host and no credentials', () => {
  assert.equal(publicLink(' https://example.com/checklist.xlsx '), 'https://example.com/checklist.xlsx');
  assert.equal(publicLink('http://example.com/x'), null);
  assert.equal(publicLink('javascript:alert(1)'), null);
  assert.equal(publicLink('https://user:secret@example.com/x'), null);
  assert.equal(publicLink('https://localhost/x'), null);
  assert.equal(publicLink('example.com/x'), null);
});

test('members save others’ items, never their own, and see them in their private Saved list until taken down', async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  assert.equal(reason(w.shelf.add(aina.id, { kind: 'Template', title: 'Going concern checklist', url: 'ftp://example.com' })), 'url');
  const { id } = value(w.shelf.add(aina.id, { kind: 'Template', title: 'Going concern checklist', url: 'https://example.com/gc.xlsx' }));

  assert.equal(reason(w.shelf.save(aina.id, id)), 'self');
  assert.equal(value(w.shelf.save(priya.id, id)).saves, 1);
  assert.equal(value(w.shelf.save(priya.id, id)).saves, 1, 'saving twice changes nothing');
  assert.deepEqual(
    w.shelf.shelf(aina.id, priya.id).map((i) => [i.title, i.saves, i.savedByViewer, i.mine]),
    [['Going concern checklist', 1, true, false]],
  );
  assert.deepEqual(
    w.shelf.saved(priya.id).map((i) => [i.title, i.owner.handle]),
    [['Going concern checklist', 'aina']],
  );
  assert.equal(w.profiles.list().find((e) => e.profile.handle === 'aina')?.points, 1, 'a save is a peer point this quarter');

  assert.equal(w.shelf.remove(priya.id, id), false, 'only the owner takes it down');
  assert.ok(w.shelf.remove(aina.id, id));
  assert.deepEqual(w.shelf.saved(priya.id), []);
  assert.deepEqual(w.shelf.shelf(aina.id, null), []);
  assert.equal(reason(w.shelf.save(priya.id, id)), 'not-found');
  assert.equal(w.profiles.list().find((e) => e.profile.handle === 'aina')?.points, 0);

  const { id: next } = value(w.shelf.add(aina.id, { kind: 'Explainer', title: 'MPERS vs MFRS', url: 'https://example.com/mpers' }));
  value(w.shelf.save(priya.id, next));
  w.later(40 * DAY);
  assert.equal(w.profiles.list().find((e) => e.profile.handle === 'aina')?.points, 0, 'last quarter’s saves no longer count');
});
