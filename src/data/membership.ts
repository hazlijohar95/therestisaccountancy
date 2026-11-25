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
}

const offer = (term: Term, months: number, sen: number): TermOffer => ({
  months,
  sen,
  price: formatRinggit(sen),
  label: `${formatRinggit(sen)} a ${term}`,
  after: (from) => addMonths(from, months),
  before: (from) => addMonths(from, -months),
});

/** The rates. Shown to invited members and charged through CHIP. Never shown on the public site. */
export const terms: Record<Term, TermOffer> = {
  month: offer('month', 1, 9900),
  year: offer('year', 12, 99000),
};

/** A subscription's term before any checkout has been paid. */
export const DEFAULT_TERM: Term = 'month';

/** The months a term gives beyond what its price buys at the monthly rate: 2 for a year. */
export const monthsFree = (term: Term) => terms[term].months - terms[term].sen / terms.month.sen;

/** "RM 99 a month or RM 990 a year" */
export const everyRate = TERMS.map((term) => terms[term].label).join(' or ');
