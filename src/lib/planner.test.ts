import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explain, plan, plannerFields, type Plan, type PlannerInputs } from './planner.ts';

/* 21 clients at RM 600 cover RM 150,000. 21 billable hours a week is 91 a month. */
const steady: PlannerInputs = { income: 120_000, costs: 30_000, fee: 600, clients: 0, months: 21, conversion: 25, churn: 0, hoursPerClient: 4, hoursPerWeek: 21 };
const leaving: PlannerInputs = { ...steady, clients: 3, months: 18, conversion: 30, churn: 10 };

function path(inputs: PlannerInputs): Extract<Plan, { kind: 'path' }> {
  const result = plan(inputs);
  assert.equal(result.kind, 'path');
  if (result.kind !== 'path') throw new Error('unreachable');
  return result;
}

const monthOf = (result: Extract<Plan, { kind: 'path' }>, kind: string) => result.milestones.find((milestone) => milestone.kind === kind)?.month;

test('with nobody leaving, wins the gap in equal steps', () => {
  const result = path(steady);
  assert.deepEqual(result.target, { revenue: 150_000, clients: 21, fees: 151_200, left: 121_200 });
  assert.equal(result.gap, 21);
  assert.equal(result.newPerMonth, 1);
  assert.equal(result.newClients, 21);
  assert.equal(result.callsPerMonth, 4);
  assert.deepEqual(result.rows.map((row) => row.clients), Array.from({ length: 22 }, (_, month) => month));
  assert.deepEqual(result.rows.map((row) => row.fees).slice(0, 3), [0, 600, 1_200]);
  assert.deepEqual(result.milestones, [{ kind: 'costs', month: 5 }, { kind: 'target', month: 21 }]);
});

test('with nobody leaving, the new clients over the plan are exactly the gap', () => {
  for (let clients = 0; clients < 21; clients++) {
    for (let months = 1; months <= 60; months++) {
      const result = path({ ...steady, clients, months });
      assert.equal(result.newClients, 21 - clients, `${clients} clients over ${months} months`);
      assert.equal(result.rows.at(-1)?.clients, 21);
    }
  }
});

test('with clients leaving, the pace it gives lands on the target when stepped month by month', () => {
  const result = path(leaving);
  const keep = 1 - 0.1 / 12;
  let expected = 3;
  const stepped = [3];
  for (let month = 1; month <= 18; month++) {
    expected = expected * keep + result.newPerMonth;
    stepped.push(expected);
  }
  assert.ok(Math.abs(expected - 21) < 1e-9, `stepped to ${expected}`);
  assert.deepEqual(result.rows.slice(0, -1).map((row) => row.clients), stepped.slice(0, -1).map(Math.floor));
  assert.ok(result.rows.slice(0, -1).every((row) => row.clients < 21), 'the target is met in the last month, not before');
  assert.equal(monthOf(result, 'target'), 18);
});

test('with clients leaving, more new clients than the gap, and more calls', () => {
  const result = path(leaving);
  assert.equal(result.gap, 18);
  assert.ok(result.newPerMonth > 18 / 18);
  assert.equal(result.newClients, 20);
  assert.equal(result.callsPerMonth, 4);
  assert.deepEqual(explain(leaving).notes.slice(0, 2), ['Of those, 2 replace clients who leave.', 'Your fees cover your running costs from month 2.']);
});

test('says the plan in one sentence', () => {
  assert.equal(explain(steady).answer, '21 clients at RM 600 a month. You have none yet. That is 21 new clients in 21 months, from 4 sales calls a month.');
  assert.equal(explain(leaving).answer, '21 clients at RM 600 a month. You have 3. That is 20 new clients in 18 months, from 4 sales calls a month.');
  const one = { ...steady, income: 0, costs: 7_200, months: 1, conversion: 100 };
  assert.equal(explain(one).answer, '1 client at RM 600 a month. You have none yet. That is 1 new client in 1 month, from 1 sales call a month.');
});

test('writes the figures and the month-by-month table', () => {
  const view = explain(leaving);
  assert.equal(view.figure, '21');
  assert.deepEqual(view.ledger, { revenue: 'RM 150,000', fees: 'RM 151,200', costs: 'RM 30,000', left: 'RM 121,200', gap: '18', newPerMonth: '1.1', calls: '4', hours: '84 of 91' });
  assert.equal(view.rows.length, 19);
  assert.deepEqual(view.rows[0], { month: 'Today', clients: '3', fees: 'RM 1,800', fill: 3 / 21, over: false, marks: '' });
  assert.deepEqual(view.rows.at(-1), { month: '18', clients: '21', fees: 'RM 12,600', fill: 1, over: false, marks: 'Target met' });
  assert.equal(view.rows[2]?.marks, 'Costs covered');
  assert.equal(view.notes.at(-1), 'At 21 clients you need 84 of the 91 hours you have a month.');
});

test('marks every milestone that falls in the same month', () => {
  const result = path({ ...steady, income: 0, months: 5 });
  assert.deepEqual(result.milestones, [{ kind: 'costs', month: 5 }, { kind: 'target', month: 5 }]);
  assert.equal(explain({ ...steady, income: 0, months: 5 }).rows.at(-1)?.marks, 'Costs covered, Target met');
});

test('counts costs as covered from today when the clients already pay for them', () => {
  const result = path({ ...steady, clients: 5 });
  assert.equal(monthOf(result, 'costs'), 0);
  assert.ok(explain({ ...steady, clients: 5 }).notes.includes('Your fees already cover your running costs.'));
});

test('already at the target needs no path', () => {
  for (const clients of [21, 30]) {
    const result = plan({ ...steady, clients });
    assert.equal(result.kind, 'there');
    assert.equal(explain({ ...steady, clients }).rows.length, 0);
  }
  assert.equal(explain({ ...steady, clients: 21 }).answer, '21 clients at RM 600 a month. You have 21. You are there already.');
  assert.equal(plan({ ...steady, clients: 21, months: 0 }).kind, 'there');
  assert.equal(plan({ ...steady, clients: 21, conversion: 0 }).kind, 'there');
});

test('already at the target says what staying there takes', () => {
  const inputs = { ...steady, clients: 30, churn: 10 };
  const result = plan(inputs);
  assert.ok(result.kind === 'there');
  assert.equal(result.replacePerYear, 3);
  assert.equal(result.hours.needed, 120);
  assert.deepEqual(explain(inputs).notes, [
    'Your clients need 120 hours a month. You have 91. Hire help or raise your fees.',
    'To stay where you are, win 3 new clients a year to replace those who leave.',
  ]);
  assert.deepEqual(explain({ ...steady, clients: 21 }).notes, ['Your clients need 84 of the 91 hours you have a month.']);
  assert.equal(explain({ ...steady, clients: 21 }).ledger.gap, '0');
});

test('finds the month the hours run out', () => {
  /* 25 clients at RM 500; one more a month; 4 hours each passes 91 at the 23rd. */
  const underpriced = { ...steady, fee: 500, months: 25 };
  const result = path(underpriced);
  assert.equal(result.target.clients, 25);
  assert.equal(monthOf(result, 'hours'), 23);
  assert.deepEqual(result.rows.map((row) => row.over), Array.from({ length: 26 }, (_, month) => month >= 23));
  assert.ok(explain(underpriced).notes.includes('Your hours run out in month 23, at 23 clients. Hire help or raise your fees before then.'));
  assert.equal(explain(underpriced).rows[23]?.marks, 'Hours run out');
});

test('finds hours that are already full today', () => {
  const full = { ...steady, fee: 500, months: 25, clients: 24 };
  assert.equal(monthOf(path(full), 'hours'), 0);
  assert.ok(explain(full).notes.includes('Your clients today already need more hours than you have. Hire help or raise your fees first.'));
});

test('hours never run out when a client takes none, and run out at the first client when you have none', () => {
  const none = path({ ...steady, hoursPerClient: 0 });
  assert.equal(monthOf(none, 'hours'), undefined);
  assert.ok(none.rows.every((row) => !row.over));
  assert.ok(explain({ ...steady, hoursPerClient: 0 }).notes.every((note) => !note.includes('hours')));
  assert.equal(monthOf(path({ ...steady, hoursPerWeek: 0 }), 'hours'), 1);
});

test('gives a reason when the figures leave nothing to plan', () => {
  assert.deepEqual(plan({ ...steady, income: 0, costs: 0 }), { kind: 'blocked', blocker: 'nothing-to-cover' });
  assert.deepEqual(plan({ ...steady, fee: 0 }), { kind: 'blocked', blocker: 'no-fee' });
  assert.deepEqual(plan({ ...steady, months: 0 }), { kind: 'blocked', blocker: 'no-time' });
  assert.deepEqual(plan({ ...steady, conversion: 0 }), { kind: 'blocked', blocker: 'no-conversion' });
  const answers = new Set(
    [{ income: 0, costs: 0 }, { fee: 0 }, { months: 0 }, { conversion: 0 }].map((change) => {
      const view = explain({ ...steady, ...change });
      assert.equal(view.figure, '—');
      assert.deepEqual(view.rows, []);
      assert.ok(Object.values(view.ledger).every((value) => value === '—'));
      return view.answer;
    }),
  );
  assert.equal(answers.size, 4, 'each reason says something different');
});

test('names the first figure out of range, in form order', () => {
  assert.deepEqual(plan({ ...steady, income: Number.NaN }), { kind: 'invalid', field: 'income' });
  assert.deepEqual(plan({ ...steady, costs: -1 }), { kind: 'invalid', field: 'costs' });
  assert.deepEqual(plan({ ...steady, fee: Number.POSITIVE_INFINITY }), { kind: 'invalid', field: 'fee' });
  assert.deepEqual(plan({ ...steady, clients: 3.5 }), { kind: 'invalid', field: 'clients' });
  assert.deepEqual(plan({ ...steady, months: 2.5 }), { kind: 'invalid', field: 'months' });
  assert.deepEqual(plan({ ...steady, months: 61 }), { kind: 'invalid', field: 'months' });
  assert.deepEqual(plan({ ...steady, conversion: 101 }), { kind: 'invalid', field: 'conversion' });
  assert.deepEqual(plan({ ...steady, churn: -5 }), { kind: 'invalid', field: 'churn' });
  assert.deepEqual(plan({ ...steady, fee: Number.NaN, hoursPerWeek: Number.NaN }), { kind: 'invalid', field: 'fee' });
  assert.equal(explain({ ...steady, fee: Number.NaN }).answer, 'Check the number marked in red.');
});

test('never throws and never produces a number that is not finite', () => {
  const extremes = [-1, 0, 0.5, 1, 59, 60, 61, 100, 101, 1e6, 1e8, 1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const numbers = (value: unknown): number[] =>
    typeof value === 'number' ? [value] : typeof value === 'object' && value !== null ? Object.values(value).flatMap(numbers) : [];
  const strings = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : typeof value === 'object' && value !== null ? Object.values(value).flatMap(strings) : [];
  for (const base of [steady, leaving]) {
    for (const field of plannerFields) {
      for (const value of extremes) {
        const inputs = { ...base, [field]: value };
        const label = `${field} = ${value}`;
        assert.ok(numbers(plan(inputs)).every(Number.isFinite), label);
        const view = explain(inputs);
        assert.ok(numbers(view).every(Number.isFinite), label);
        assert.ok(strings(view).every((text) => !/NaN|Infinity|undefined|∞/.test(text)), label);
      }
    }
  }
});
