export const formatRinggit = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: sen % 100 ? 2 : 0 })}`;

/** Calendar months on, or back when negative: 31 January plus one is 28 or 29 February, not 3 March. */
const addMonths = (from: Date, months: number): Date => {
  const moved = new Date(from);
  const day = moved.getUTCDate();
  moved.setUTCDate(1);
  moved.setUTCMonth(moved.getUTCMonth() + months);
  const last = new Date(Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, 0)).getUTCDate();
  moved.setUTCDate(Math.min(day, last));
  return moved;
};

/** What a member can pay for at once. The key is the word for it in copy: "a month", "your paid year". */
export const TERMS = ['month', 'year'] as const;
export type Term = (typeof TERMS)[number];

export interface TermOffer {
  readonly months: number;
  /** Charged through CHIP, in sen. */
  readonly sen: number;
  /** "RM 990" */
  readonly price: string;
  /** "RM 990 a year" */
  readonly label: string;
  /** The end of a term that starts at this moment. */
  readonly after: (from: Date) => Date;
  /** The same term taken back off. A day clamped to a shorter month stays clamped, so this undoes after() only up to that. */
  readonly before: (from: Date) => Date;
  /** Days of warning before a saved card is charged for this term. A year's charge is large enough to warrant it. */
  readonly noticeDays: number;
}

const offer = (term: Term, months: number, sen: number, noticeDays: number): TermOffer => ({
  noticeDays,
  months,
  sen,
  price: formatRinggit(sen),
  label: `${formatRinggit(sen)} a ${term}`,
  after: (from) => addMonths(from, months),
  before: (from) => addMonths(from, -months),
});

/** The rates. Shown to invited members and charged through CHIP. Never shown on the public site. */
export const terms: Record<Term, TermOffer> = {
  month: offer('month', 1, 9900, 0),
  year: offer('year', 12, 99000, 7),
};

/** A subscription's term before any checkout has been paid. */
export const DEFAULT_TERM: Term = 'month';

/** The months a term gives beyond what its price buys at the monthly rate: 2 for a year. */
export const monthsFree = (term: Term) => terms[term].months - terms[term].sen / terms.month.sen;

/** "a month or a year" */
export const anyTerm = TERMS.map((term) => `a ${term}`).join(' or ');

/** "RM 99 a month or RM 990 a year" */
export const everyRate = TERMS.map((term) => terms[term].label).join(' or ');

/** A member's first month, paid at checkout before they have ever paid. Every later month, and every year, is at the rate. */
export const FIRST_MONTH_SEN = 500;
/** "RM 5" */
export const firstMonthPrice = formatRinggit(FIRST_MONTH_SEN);
/** For someone who has not paid yet: "Your first month is RM 5. After that, membership is RM 99 a month or RM 990 a year." */
export const joiningRate = `Your first month is ${firstMonthPrice}. After that, membership is ${everyRate}.`;

/** Why a member turned renewal off, as they may say. The key is stored; the label is what they read and the host sees. */
export const STOP_REASONS = ['time', 'value', 'price', 'done', 'other'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const stopReasonLabel: Record<StopReason, string> = {
  time: "I don't have the time to use it",
  value: "It isn't what I needed",
  price: 'It costs too much right now',
  done: 'I got what I came for',
  other: 'Something else',
};

export const STOP_NOTE_MAX = 500;
