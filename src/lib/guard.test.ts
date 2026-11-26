import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identifying, ROLE_TITLE_SKIP } from './guard.ts';

test('each kind of clue that points at a client is caught, and plain notes pass', () => {
  assert.deepEqual(identifying('Pushed back on a stock provision that relied on one supplier quote.'), []);
  assert.deepEqual(identifying('Revenue of RM12m'), ['Figures narrow it down. Use the size band.']);
  assert.deepEqual(identifying('about 3.5 million in debtors'), ['Figures narrow it down. Use the size band.']);
  assert.deepEqual(identifying('Halim Ng Sdn. Bhd. group'), ['Looks like a company name.']);
  assert.deepEqual(identifying('A plant in Klang'), ['Place names narrow it down.']);
  assert.deepEqual(identifying('A Bursa main market client'), ['Listing status narrows it down.']);
  assert.deepEqual(identifying('the 2023 year end'), ['Dates narrow it down. The year is set above.']);
  assert.deepEqual(identifying('the largest glove maker'), ['“Only” and “largest” point at one client.']);
  assert.equal(identifying('RM5m listed on Bursa in 2021, the only one in Ipoh').length, 5, 'one message per kind, not per match');
});

test('role titles allow “first” and “sole”, and still refuse a company name', () => {
  assert.deepEqual(identifying('First-year associate', ROLE_TITLE_SKIP), []);
  assert.deepEqual(identifying('Sole practitioner', ROLE_TITLE_SKIP), []);
  assert.deepEqual(identifying('Partner, Halim Ng PLT', ROLE_TITLE_SKIP), ['Looks like a company name.']);
});
