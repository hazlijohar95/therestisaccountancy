import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GROUP_MIN, PUBLISH_MIN } from '../data/fees.ts';
import { createClub } from './club.ts';
import { createFees, editionOf, niceCeiling, quantile, results, spread, type FeeAnswers, type FigureResult, type Spread } from './fees.ts';
import { openDatabase } from './node-db.ts';

const DAY = 86_400_000;

const answer = (overrides: Partial<FeeAnswers> = {}): FeeAnswers => ({
  stage: 'own',
  years: '2-4',
  team: 'solo',
  pricing: 'fixed',
  state: 'Selangor',
  niche: false,
  confidence: 3,
  fees: { hourly: 150, bookkeeping: 800, taxReturn: 2500 },
  ...overrides,
});

const world = () => {
  let clock = new Date('2026-06-01T02:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  const host = createClub(db, now).appointAdmin({ email: 'host@club.my', name: 'Host' });
  return {
    fees: createFees(db, now),
    host,
    at: (when: string) => (clock = new Date(when)),
    later: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
};

const shown = (result: FigureResult | undefined): Extract<FigureResult, { everyone: Spread }> => {
  assert.ok(result && result.everyone, 'the figure has enough answers to show');
  return result;
};

test('quartiles interpolate between neighbours, as a spreadsheet works them out', () => {
  assert.equal(quantile([10, 20, 30, 40, 50, 60], 0.25), 22.5);
  assert.equal(quantile([10, 20, 30, 40, 50, 60], 0.5), 35);
  assert.equal(quantile([10, 20, 30, 40, 50, 60], 0.75), 47.5);
  assert.equal(quantile([7], 0.5), 7);
  assert.deepEqual(spread([400, 100, 200, 150, 120]), { n: 5, p25: 120, median: 150, p75: 200 }, 'answers arrive in any order');
});

test('a group smaller than the minimum gets no figures at all', () => {
  const answers = (n: number) => Array.from({ length: n }, (_, i) => 100 + i * 10);
  assert.equal(spread(answers(GROUP_MIN - 1)), null);
  assert.equal(spread(answers(GROUP_MIN))?.n, GROUP_MIN);
});

test('an answer belongs to the year it was given in Malaysia', () => {
  assert.equal(editionOf(new Date('2026-12-31T15:59:59Z')), 2026, '11:59 pm on 31 December');
  assert.equal(editionOf(new Date('2026-12-31T16:00:00Z')), 2027, 'midnight in Kuala Lumpur, still 2026 in London');
});

test('an axis ends on a round figure at or above the widest bar', () => {
  assert.equal(niceCeiling(230), 250);
  assert.equal(niceCeiling(300), 300);
  assert.equal(niceCeiling(1800), 2000);
  assert.equal(niceCeiling(3200), 4000);
  assert.equal(niceCeiling(85), 100);
});

test('results break each fee down by years, niche, pricing and confidence, hiding groups that are too small', () => {
  const answers = [
    ...[100, 120, 140, 160, 180].map((hourly) => answer({ years: 'under-2', niche: true, confidence: 5, fees: { hourly, bookkeeping: null, taxReturn: null } })),
    ...[200, 220, 240].map((hourly) => answer({ years: '10-plus', confidence: 1, fees: { hourly, bookkeeping: 900, taxReturn: null } })),
  ];
  const [hourly, bookkeeping, taxReturn] = results(answers);

  const h = shown(hourly);
  assert.equal(h.figure, 'hourly');
  assert.deepEqual(h.everyone, { n: 8, p25: 135, median: 170, p75: 205 });
  const years = h.cuts.find((c) => c.title === 'Years in practice');
  assert.deepEqual(years?.groups.map((g) => [g.label, g.spread]), [
    ['Under 2 years', { n: 5, p25: 120, median: 140, p75: 160 }],
    ['2 to 4 years', null],
    ['5 to 9 years', null],
    ['10 years or more', null],
  ]);
  const niche = h.cuts.find((c) => c.title === 'Niche or generalist');
  assert.deepEqual(niche?.groups.map((g) => g.spread?.median ?? null), [140, null], 'three generalists are too few to show');
  const sure = h.cuts.find((c) => c.title === 'How sure they are of their prices');
  assert.deepEqual(sure?.groups.map((g) => [g.label, g.spread?.n ?? null]), [['Not sure (1 or 2)', null], ['In between (3)', null], ['Sure (4 or 5)', 5]]);
  assert.equal(h.scale, 250, 'the axis reaches past the widest middle half');

  assert.equal(bookkeeping?.everyone, null, 'only three gave a bookkeeping fee');
  assert.equal(taxReturn?.everyone, null);
});

test('answers go into this year, and an edition is published only once enough have answered', () => {
  const w = world();
  assert.deepEqual(w.fees.editions(), [{ edition: 2026, responses: 0, status: 'open', publishedAt: null, publishable: false }], 'this year shows before anyone answers');

  for (let i = 1; i < PUBLISH_MIN; i += 1) assert.deepEqual(w.fees.respond(answer()), { ok: true, value: { edition: 2026 } });
  assert.deepEqual(w.fees.publish(2026, w.host.id), { ok: false, reason: 'too-few' });
  assert.equal(w.fees.report(2026).publishedAt, null);

  w.fees.respond(answer());
  assert.equal(w.fees.current().publishable, true);
  const published = w.fees.publish(2026, w.host.id);
  assert.ok(published.ok);
  assert.equal(published.value.status, 'published');
  assert.equal(published.value.publishedAt, '2026-06-01T02:00:00Z');
  assert.equal(w.fees.report(2026).publishedAt, '2026-06-01T02:00:00Z');
  assert.equal(shown(w.fees.report(2026).figures[0]).everyone.median, 150);

  w.later(DAY);
  assert.deepEqual(w.fees.respond(answer()), { ok: false, reason: 'closed' }, 'published results take no answers a host has not seen');
  assert.equal(w.fees.current().responses, PUBLISH_MIN);
  const again = w.fees.publish(2026, w.host.id);
  assert.equal(again.ok && again.value.publishedAt, '2026-06-01T02:00:00Z', 'publishing twice keeps the first date');

  assert.equal(w.fees.unpublish(2026).status, 'open');
  assert.equal(w.fees.report(2026).publishedAt, null);
  assert.deepEqual(w.fees.respond(answer()), { ok: true, value: { edition: 2026 } }, 'taken down, this year takes answers again');
});

test('a new year opens a new edition and leaves the last one for a host to publish', () => {
  const w = world();
  for (let i = 0; i < PUBLISH_MIN; i += 1) w.fees.respond(answer());
  w.at('2026-12-31T16:30:00Z');
  w.fees.respond(answer({ fees: { hourly: 300, bookkeeping: null, taxReturn: null } }));

  assert.deepEqual(
    w.fees.editions().map((e) => [e.edition, e.responses, e.status, e.publishable]),
    [
      [2027, 1, 'open', false],
      [2026, PUBLISH_MIN, 'closed', true],
    ],
  );
  assert.ok(w.fees.publish(2026, w.host.id).ok);
  assert.equal(w.fees.current().status, 'open', 'publishing last year closes nothing this year');
  assert.equal(w.fees.unpublish(2026).status, 'closed', 'a past year taken down stays closed to answers');
});

test('a host sees answers newest first, with figures far from the rest marked, and can delete one', () => {
  const w = world();
  for (const hourly of [140, 150, 150, 160, 170]) w.fees.respond(answer({ fees: { hourly, bookkeeping: 800, taxReturn: null } }));
  w.fees.respond(answer({ fees: { hourly: 1900, bookkeeping: 800, taxReturn: null } }));

  const page = w.fees.review(2026, { limit: 4, offset: 0 });
  assert.equal(page.total, 6);
  assert.deepEqual(page.items.map((r) => [r.fees.hourly, r.unusual]), [[1900, ['hourly']], [170, []], [160, []], [150, []]]);

  const junk = page.items[0];
  assert.ok(junk);
  assert.equal(w.fees.remove(junk.id), true);
  assert.equal(w.fees.remove(junk.id), false, 'already gone');
  assert.equal(w.fees.answers(2026).length, 5);
  assert.equal(shown(w.fees.report(2026).figures[0]).everyone.p75, 160, 'the deleted answer no longer counts');
});
