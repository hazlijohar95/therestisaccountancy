import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntryDraft } from './social-casebook.ts';
import { reason, socialWorld, value } from './social-fixtures.ts';

const entry = (changes: Partial<EntryDraft> = {}): EntryDraft => ({
  service: 'Audit',
  industry: 'Manufacturing',
  band: 'RM5m–50m',
  framework: 'MPERS',
  year: '2024',
  role: 'Senior',
  areas: ['Inventory'],
  note: 'Pushed back on a stock provision that relied on one supplier quote.',
  cosigner: null,
  ...changes,
});

test('an entry names no client: the guard refuses figures, names, places, listings, dates and superlatives', async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  for (const note of ['Revenue of RM12m', 'Halim Ng Sdn Bhd', 'A plant in Klang', 'Listed on Bursa', 'The 2023 year end', 'The largest glove maker']) {
    assert.equal(reason(w.casebook.add(aina.id, entry({ note }))), 'identifying', note);
  }
  assert.equal(reason(w.casebook.add(aina.id, entry({ year: '2026' }))), 'year', 'a year that has not ended');
  assert.equal(reason(w.casebook.add((await w.host).id, entry())), 'no-handle');
  value(w.casebook.add(aina.id, entry({ year: 'Earlier' })));
  assert.equal(w.casebook.entries(aina.id).length, 1);
});

test('a co-signer must hold the seal; they decide once, and the author hears', async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  assert.equal(reason(w.casebook.add(aina.id, entry({ cosigner: 'abu' }))), 'cosigner-no-seal');
  assert.equal(reason(w.casebook.add(aina.id, entry({ cosigner: '@nobody' }))), 'cosigner-not-found');
  await w.seal(aina.id, 'aina-rahman');
  assert.equal(reason(w.casebook.add(aina.id, entry({ cosigner: 'aina' }))), 'cosigner-self');
  await w.seal(priya.id, 'priya-nair');
  const { id } = value(w.casebook.add(aina.id, entry({ cosigner: '@Priya' })));

  const [request] = w.casebook.requests(priya.id);
  assert.equal(request?.author.handle, 'aina');
  assert.equal(request?.entry.cosign, 'pending');
  const asked = w.notifications.list(priya.id).find((n) => n.kind === 'cosign-request');
  assert.ok(asked?.kind === 'cosign-request' && asked.live);

  assert.equal(reason(w.casebook.decide(abu.id, id, 'signed')), 'not-found', 'only the named co-signer');
  value(w.casebook.decide(priya.id, id, 'signed'));
  assert.equal(reason(w.casebook.decide(priya.id, id, 'declined')), 'already');
  assert.deepEqual(w.casebook.requests(priya.id), []);
  const done = w.notifications.list(priya.id).find((n) => n.kind === 'cosign-request');
  assert.ok(done?.kind === 'cosign-request');
  assert.deepEqual([done.live, done.decision], [false, 'signed']);
  const heard = w.notifications.list(aina.id).find((n) => n.kind === 'cosign-outcome');
  assert.ok(heard?.kind === 'cosign-outcome');
  assert.equal(heard.outcome, 'signed');
});

test('the heatmap counts entries by industry and work, and a co-sign while its co-signer holds the seal', async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const body = await w.seal(priya.id, 'priya-nair');
  const { id } = value(w.casebook.add(aina.id, entry({ cosigner: 'priya' })));
  value(w.casebook.add(aina.id, entry()));
  value(w.casebook.add(aina.id, entry({ service: 'Tax', industry: 'Property' })));
  value(w.casebook.decide(priya.id, id, 'signed'));

  const map = w.casebook.heatmap(aina.id);
  assert.deepEqual([map.entries, map.cosigned], [3, 1]);
  assert.deepEqual(map.industries, ['Manufacturing', 'Property'], 'in the registry order');
  assert.deepEqual(
    map.cells.find((c) => c.industry === 'Manufacturing' && c.service === 'Audit'),
    { industry: 'Manufacturing', service: 'Audit', entries: 2, cosigned: 1 },
  );
  assert.ok(w.claims.removeClaim(priya.id, body.id).removed);
  assert.equal(w.casebook.heatmap(aina.id).cosigned, 0, 'read from her ticks now');
  assert.ok(w.casebook.remove(aina.id, id));
  assert.equal(w.casebook.remove(priya.id, id), false, 'only the author removes it');
});

test('roles name the kind of employer from a list, and their titles and years are checked', async () => {
  const w = socialWorld();
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  assert.equal(reason(w.casebook.addRole(aina.id, { from: 2017, to: null, title: 'Partner, Halim Ng PLT', employer: 'Own practice' })), 'identifying');
  assert.equal(reason(w.casebook.addRole(aina.id, { from: 2019, to: 2017, title: 'Manager', employer: 'Mid-tier firm' })), 'years');
  assert.equal(reason(w.casebook.addRole(aina.id, { from: 2027, to: null, title: 'Manager', employer: 'Mid-tier firm' })), 'years', 'not in the future');
  value(w.casebook.addRole(aina.id, { from: 2021, to: null, title: 'Sole practitioner', employer: 'Own practice' }));
  value(w.casebook.addRole(aina.id, { from: 2012, to: 2021, title: 'First-year associate to manager', employer: 'Big Four firm' }));
  assert.deepEqual(
    w.casebook.roles(aina.id).map((r) => [r.from, r.to, r.employer]),
    [
      [2012, 2021, 'Big Four firm'],
      [2021, null, 'Own practice'],
    ],
  );
});
