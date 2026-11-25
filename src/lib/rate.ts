export const WEEKS_IN_YEAR = 52;

export interface RateInputs {
  readonly income: number;
  readonly costs: number;
  readonly hoursPerWeek: number;
  readonly weeksOff: number;
  /** Percent of working time nobody pays for: admin, sales, chasing, learning. */
  readonly unpaidShare: number;
}

export interface Rate {
  readonly revenue: number;
  readonly billableHours: number;
  /** Rounded up to the next ringgit: a floor is never rounded down. */
  readonly hourly: number;
}

/** The lowest hourly fee that pays the income wanted and the running costs. Null when no hours are billable. */
export function floorRate(inputs: RateInputs): Rate | null {
  const billableHours = inputs.hoursPerWeek * (WEEKS_IN_YEAR - inputs.weeksOff) * (1 - inputs.unpaidShare / 100);
  if (!(billableHours > 0)) return null;
  const revenue = inputs.income + inputs.costs;
  return { revenue, billableHours, hourly: Math.ceil(revenue / billableHours) };
}
