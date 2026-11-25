import { WEEKS_IN_YEAR } from './rate.ts';

/** The planner's figures, in the order the form asks for them. */
export const plannerFields = ['income', 'costs', 'fee', 'clients', 'months', 'conversion', 'churn', 'hoursPerClient', 'hoursPerWeek'] as const;

export type PlannerField = (typeof plannerFields)[number];

export type PlannerInputs = { readonly [K in PlannerField]: number };

export interface Limit {
  readonly min: number;
  readonly max: number;
  readonly whole?: boolean;
}

/** The range each figure must fall in. The form takes its bounds from here. */
export const limits: { readonly [K in PlannerField]: Limit } = {
  /** Ringgit a year. */
  income: { min: 0, max: 100_000_000 },
  /** Ringgit a year. */
  costs: { min: 0, max: 100_000_000 },
  /** Ringgit a month, the average across clients. */
  fee: { min: 0, max: 1_000_000 },
  clients: { min: 0, max: 100_000, whole: true },
  /** Bounded so the month-by-month table stays readable. */
  months: { min: 0, max: 60, whole: true },
  /** Percent of sales calls that become clients. */
  conversion: { min: 0, max: 100 },
  /** Percent of clients who leave in a year. */
  churn: { min: 0, max: 100 },
  /** Hours a month. */
  hoursPerClient: { min: 0, max: 200 },
  /** Billable hours a week, averaged over the year. */
  hoursPerWeek: { min: 0, max: 100 },
};

export function withinLimits(field: PlannerField, value: number): boolean {
  const { min, max, whole = false } = limits[field];
  return Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value));
}

/** Why no plan can be drawn from figures that are each in range. */
export type Blocker = 'nothing-to-cover' | 'no-fee' | 'no-time' | 'no-conversion';

export interface Target {
  /** The income wanted plus running costs, a year. */
  readonly revenue: number;
  /** Clients at the average fee that pay for it, rounded up. */
  readonly clients: number;
  /** A year's fees from that many clients. */
  readonly fees: number;
  /** Fees less running costs. Never below the income wanted, since clients round up. */
  readonly left: number;
}

export interface Hours {
  /** Billable hours a month you have. */
  readonly available: number;
  /** Hours a month the clients at the end of the plan take. */
  readonly needed: number;
}

export type MilestoneKind = 'costs' | 'hours' | 'target';

export interface Milestone {
  readonly kind: MilestoneKind;
  readonly month: number;
}

export interface Row {
  /** 0 is today. */
  readonly month: number;
  /** Whole clients at the end of the month. */
  readonly clients: number;
  readonly fees: number;
  /** Clients as a share of the target, 0 to 1. */
  readonly fill: number;
  /** These clients need more hours than you have. */
  readonly over: boolean;
  readonly marks: readonly MilestoneKind[];
}

export type Plan =
  | { readonly kind: 'invalid'; readonly field: PlannerField }
  | { readonly kind: 'blocked'; readonly blocker: Blocker }
  | {
      readonly kind: 'there';
      readonly target: Target;
      readonly hours: Hours;
      /** New clients a year to replace the ones who leave. */
      readonly replacePerYear: number;
    }
  | {
      readonly kind: 'path';
      readonly target: Target;
      readonly hours: Hours;
      readonly gap: number;
      /** Exact, so the path lands on the target. Show it rounded. */
      readonly newPerMonth: number;
      /** New clients over the whole plan, rounded up. More than the gap when clients leave. */
      readonly newClients: number;
      /** Rounded up from the exact new clients a month. */
      readonly callsPerMonth: number;
      readonly rows: readonly Row[];
      /** In month order. A milestone that never happens is absent. */
      readonly milestones: readonly Milestone[];
    };

/* Float noise must not push an exact answer across a whole number: 1 / 49 * 49 is 0.9999999999999999. */
const EPSILON = 1e-9;
const up = (value: number) => Math.ceil(value - EPSILON);
const down = (value: number) => Math.floor(value + EPSILON);
const exceeds = (needed: number, available: number) => needed > available + EPSILON;

/**
 * How many clients the income wanted takes, and the steady pace of new clients that reaches them in the months given.
 * Each month a twelfth of the yearly churn leaves, then the new clients arrive: c(k) = c(k - 1) × (1 - m) + n.
 */
export function plan(inputs: PlannerInputs): Plan {
  const field = plannerFields.find((name) => !withinLimits(name, inputs[name]));
  if (field) return { kind: 'invalid', field };
  const { income, costs, fee, clients: today, months, conversion, churn, hoursPerClient, hoursPerWeek } = inputs;

  const revenue = income + costs;
  if (revenue === 0) return { kind: 'blocked', blocker: 'nothing-to-cover' };
  if (fee === 0) return { kind: 'blocked', blocker: 'no-fee' };
  const clients = up(revenue / (fee * 12));
  const fees = clients * fee * 12;
  const target: Target = { revenue, clients, fees, left: fees - costs };
  const available = (hoursPerWeek * WEEKS_IN_YEAR) / 12;
  const hoursFor = (count: number) => count * hoursPerClient;

  if (today >= clients) {
    return { kind: 'there', target, hours: { available, needed: hoursFor(today) }, replacePerYear: up((today * churn) / 100) };
  }
  if (months === 0) return { kind: 'blocked', blocker: 'no-time' };
  if (conversion === 0) return { kind: 'blocked', blocker: 'no-conversion' };

  const leaving = churn / 100 / 12;
  const staying = 1 - leaving;
  const newPerMonth =
    leaving === 0 ? (clients - today) / months : ((clients - today * staying ** months) * leaving) / (1 - staying ** months);

  let expected = today;
  const counts = [today];
  for (let month = 1; month <= months; month++) {
    expected = expected * staying + newPerMonth;
    counts.push(month === months ? clients : down(expected));
  }

  const found = (kind: MilestoneKind, month: number): Milestone[] => (month === -1 ? [] : [{ kind, month }]);
  const milestones = [
    ...found('costs', counts.findIndex((count) => count * fee * 12 >= costs - EPSILON)),
    ...found('hours', counts.findIndex((count) => exceeds(hoursFor(count), available))),
    ...found('target', counts.findIndex((count) => count >= clients)),
  ].sort((a, b) => a.month - b.month);

  const rows = counts.map((count, month) => ({
    month,
    clients: count,
    fees: count * fee,
    fill: count / clients,
    over: exceeds(hoursFor(count), available),
    marks: milestones.filter((milestone) => milestone.month === month).map((milestone) => milestone.kind),
  }));

  return {
    kind: 'path',
    target,
    hours: { available, needed: hoursFor(clients) },
    gap: clients - today,
    newPerMonth,
    newClients: up(newPerMonth * months),
    callsPerMonth: up(newPerMonth / (conversion / 100)),
    rows,
    milestones,
  };
}

const whole = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });
const tenths = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 1 });
const ringgit = (value: number) => `RM ${whole.format(value)}`;
const tally = (count: number, one: string, many = `${one}s`) => `${whole.format(count)} ${count === 1 ? one : many}`;
const hoursOf = (hours: Hours) => `${whole.format(hours.needed)} of ${whole.format(hours.available)}`;

const blockers: Record<Blocker, string> = {
  'nothing-to-cover': 'Put in the income you want, or what the practice costs to run. With neither, there is nothing to plan.',
  'no-fee': 'No number of clients at RM 0 a month pays for anything. Put in what a client pays you.',
  'no-time': 'With no months to get there, the gap stays open. Give it at least one.',
  'no-conversion': 'If no sales call becomes a client, no number of calls closes the gap. Put in the share that does.',
};

/** What a milestone's row says in the month-by-month table. */
export const markLabels: Record<MilestoneKind, string> = {
  costs: 'Costs covered',
  hours: 'Hours run out',
  target: 'Target met',
};

export type LedgerLine = 'revenue' | 'fees' | 'costs' | 'left' | 'gap' | 'newPerMonth' | 'calls' | 'hours';

export interface TableRow {
  readonly month: string;
  readonly clients: string;
  readonly fees: string;
  readonly fill: number;
  readonly over: boolean;
  readonly marks: string;
}

export interface Explanation {
  /** The clients needed: the page's big figure. */
  readonly figure: string;
  /** One sentence a person could repeat to a partner. */
  readonly answer: string;
  readonly notes: readonly string[];
  readonly ledger: Readonly<Record<LedgerLine, string>>;
  /** Empty unless there is a path to draw. */
  readonly rows: readonly TableRow[];
}

const NONE = '—';
const emptyLedger: Record<LedgerLine, string> = { revenue: NONE, fees: NONE, costs: NONE, left: NONE, gap: NONE, newPerMonth: NONE, calls: NONE, hours: NONE };

/** The plan in words and figures, ready to write into the page. */
export function explain(inputs: PlannerInputs): Explanation {
  const result = plan(inputs);
  switch (result.kind) {
    case 'invalid':
      return { figure: NONE, answer: 'Check the number marked in red.', notes: [], ledger: emptyLedger, rows: [] };
    case 'blocked':
      return { figure: NONE, answer: blockers[result.blocker], notes: [], ledger: emptyLedger, rows: [] };
    case 'there': {
      const { target, hours, replacePerYear } = result;
      const notes = [
        ...hoursNote('Your clients', hours),
        ...(replacePerYear === 0 ? [] : [`To stay where you are, win ${tally(replacePerYear, 'new client')} a year to replace those who leave.`]),
      ];
      return {
        figure: whole.format(target.clients),
        answer: `${opening(inputs, target)} You are there already.`,
        notes,
        ledger: { ...ledgerFor(inputs, target, hours), gap: '0' },
        rows: [],
      };
    }
    case 'path': {
      const { target, hours, gap, newPerMonth, newClients, callsPerMonth, rows, milestones } = result;
      const replacing = newClients - gap;
      const notes = [
        ...(replacing <= 0 ? [] : [replacing === 1 ? 'Of those, 1 replaces a client who leaves.' : `Of those, ${whole.format(replacing)} replace clients who leave.`]),
        ...rows.flatMap((row) => row.marks.flatMap((kind) => milestoneNote(kind, row))),
        ...(milestones.some((milestone) => milestone.kind === 'hours') ? [] : hoursNote(`At ${tally(target.clients, 'client')} you`, hours)),
      ];
      return {
        figure: whole.format(target.clients),
        answer: `${opening(inputs, target)} That is ${tally(newClients, 'new client')} in ${tally(inputs.months, 'month')}, from ${tally(callsPerMonth, 'sales call')} a month.`,
        notes,
        ledger: { ...ledgerFor(inputs, target, hours), gap: whole.format(gap), newPerMonth: tenths.format(newPerMonth), calls: whole.format(callsPerMonth) },
        rows: rows.map((row) => ({
          month: row.month === 0 ? 'Today' : String(row.month),
          clients: whole.format(row.clients),
          fees: ringgit(row.fees),
          fill: row.fill,
          over: row.over,
          marks: row.marks.map((kind) => markLabels[kind]).join(', '),
        })),
      };
    }
  }
}

function milestoneNote(kind: MilestoneKind, row: Row): string[] {
  switch (kind) {
    case 'costs':
      return [row.month === 0 ? 'Your fees already cover your running costs.' : `Your fees cover your running costs from month ${row.month}.`];
    case 'hours':
      return [
        row.month === 0
          ? 'Your clients today already need more hours than you have. Hire help or raise your fees first.'
          : `Your hours run out in month ${row.month}, at ${tally(row.clients, 'client')}. Hire help or raise your fees before then.`,
      ];
    case 'target':
      return [];
  }
}

function hoursNote(who: string, hours: Hours): string[] {
  if (hours.needed === 0) return [];
  const needed = whole.format(hours.needed);
  const available = whole.format(hours.available);
  return exceeds(hours.needed, hours.available)
    ? [`${who} need ${needed} hours a month. You have ${available}. Hire help or raise your fees.`]
    : [`${who} need ${needed} of the ${available} hours you have a month.`];
}

function opening(inputs: PlannerInputs, target: Target): string {
  const have = inputs.clients === 0 ? 'You have none yet.' : `You have ${whole.format(inputs.clients)}.`;
  return `${tally(target.clients, 'client')} at ${ringgit(inputs.fee)} a month. ${have}`;
}

function ledgerFor(inputs: PlannerInputs, target: Target, hours: Hours): Record<LedgerLine, string> {
  return { ...emptyLedger, revenue: ringgit(target.revenue), fees: ringgit(target.fees), costs: ringgit(inputs.costs), left: ringgit(target.left), hours: hoursOf(hours) };
}
