import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorRate } from './rate.ts';

const typical = { income: 120_000, costs: 30_000, hoursPerWeek: 40, weeksOff: 6, unpaidShare: 40 };

test('covers income and costs over the hours that are actually billed', () => {
  const rate = floorRate(typical);
  assert.ok(rate);
  assert.equal(rate.revenue, 150_000);
  assert.equal(Math.round(rate.billableHours), 1_104);
  assert.equal(rate.hourly, 136);
});

test('rounds up, never down', () => {
  assert.equal(floorRate({ ...typical, income: 1, costs: 0, hoursPerWeek: 3, weeksOff: 51, unpaidShare: 0 })?.hourly, 1);
  assert.equal(floorRate({ ...typical, income: 10, costs: 0, hoursPerWeek: 3, weeksOff: 51, unpaidShare: 0 })?.hourly, 4);
});

test('gives no rate when no hour is billable', () => {
  assert.equal(floorRate({ ...typical, weeksOff: 52 }), null);
  assert.equal(floorRate({ ...typical, unpaidShare: 100 }), null);
});
