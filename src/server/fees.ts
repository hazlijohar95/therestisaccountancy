import { states, type State } from '../data/directory.ts';
import { confidence, FEE_FIGURES, feeChoices, GROUP_MIN, PUBLISH_MIN, type Choice, type Confidence, type FeeFigure } from '../data/fees.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import type { Result } from './result.ts';

/** One person's answers. The form asks for nothing that says who they are, and nothing else is kept. */
export interface FeeAnswers {
  readonly stage: Choice<'stage'>;
  readonly years: Choice<'years'>;
  readonly team: Choice<'team'>;
  readonly pricing: Choice<'pricing'>;
  readonly state: State;
  readonly niche: boolean;
  readonly confidence: Confidence;
  /** Whole ringgit, or null where they left it blank. At least one is given. */
  readonly fees: Readonly<Record<FeeFigure, number | null>>;
}

export interface FeeResponse extends FeeAnswers {
  readonly id: number;
  readonly edition: number;
  readonly createdAt: string;
}

/** A response as a host reviews it: with the figures that sit far from everyone else's. */
export interface ReviewedResponse extends FeeResponse {
  readonly unusual: readonly FeeFigure[];
}

/**
 * open: this year's, taking answers. closed: a past year's, waiting for a host. published: its results are public
 * and it takes no more answers, so every answer in published results is one a host has seen.
 */
export type EditionStatus = 'open' | 'closed' | 'published';

export interface Edition {
  /** The Malaysian calendar year the answers were given in. */
  readonly edition: number;
  readonly responses: number;
  readonly status: EditionStatus;
  readonly publishedAt: string | null;
  /** Not yet published, and enough answers to be. */
  readonly publishable: boolean;
}

/** The median and the middle half of a group's answers. */
export interface Spread {
  readonly n: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
}

/** A group's spread, or null when fewer than GROUP_MIN answered, so a small group carries no figures at all. */
export interface Group {
  readonly label: string;
  readonly spread: Spread | null;
}

export interface Cut {
  readonly title: string;
  readonly groups: readonly Group[];
}

/**
 * One fee across every cut. Null for everyone when fewer than GROUP_MIN gave this fee, which leaves every group
 * smaller still. scale is the top of the axis every bar in the table shares, from zero.
 */
export type FigureResult =
  | { readonly figure: FeeFigure; readonly everyone: null }
  | { readonly figure: FeeFigure; readonly everyone: Spread; readonly cuts: readonly Cut[]; readonly scale: number };

export interface Report {
  readonly edition: number;
  readonly responses: number;
  readonly publishedAt: string | null;
  readonly figures: readonly FigureResult[];
}

export type PublishRefusal = 'too-few';
export type AnswerRefusal = 'closed';

const MALAYSIA_OFFSET_MS = 8 * 3_600_000;

/** The edition an answer belongs to: the calendar year in Malaysia when it was given. */
export const editionOf = (at: Date) => new Date(at.getTime() + MALAYSIA_OFFSET_MS).getUTCFullYear();

/** The p-quantile of sorted values, interpolated linearly between neighbours, as Excel's PERCENTILE.INC does. */
export function quantile(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const below = Math.floor(at);
  const low = sorted[below];
  const high = sorted[Math.min(below + 1, sorted.length - 1)];
  if (low === undefined || high === undefined) throw new RangeError('A quantile needs at least one value.');
  return low + (at - below) * (high - low);
}

/** The median and quartiles of a group's answers. Null for a group under GROUP_MIN. */
export function spread(values: readonly number[]): Spread | null {
  if (values.length < GROUP_MIN) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p25: quantile(sorted, 0.25), median: quantile(sorted, 0.5), p75: quantile(sorted, 0.75) };
}

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The smallest round figure at or above a value, for the end of an axis: 230 becomes 250, 1,800 becomes 2,000. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return (STEPS.find((step) => step * magnitude >= value) ?? 10) * magnitude;
}

/** Answers further than one and a half middle halves beyond the middle half: Tukey's fences. Null for a small group. */
export function fences(values: readonly number[]): { readonly low: number; readonly high: number } | null {
  const s = spread(values);
  if (!s) return null;
  const reach = 1.5 * (s.p75 - s.p25);
  return { low: s.p25 - reach, high: s.p75 + reach };
}

interface CutRule {
  readonly title: string;
  readonly groups: readonly { readonly label: string; readonly has: (r: FeeAnswers) => boolean }[];
}

/** How the results are broken down. Each cut covers every answer once. */
const CUTS: readonly CutRule[] = [
  { title: 'Years in practice', groups: feeChoices.years.options.map((o) => ({ label: o.label, has: (r: FeeAnswers) => r.years === o.slug })) },
  {
    title: 'Niche or generalist',
    groups: [
      { label: 'Serve a niche', has: (r: FeeAnswers) => r.niche },
      { label: 'Take most kinds of client', has: (r: FeeAnswers) => !r.niche },
    ],
  },
  { title: 'How they price', groups: feeChoices.pricing.options.map((o) => ({ label: o.label, has: (r: FeeAnswers) => r.pricing === o.slug })) },
  { title: 'How sure they are of their prices', groups: confidence.bands.map((b) => ({ label: b.label, has: (r: FeeAnswers) => r.confidence >= b.from && r.confidence <= b.to })) },
];

const given = (responses: readonly FeeAnswers[], figure: FeeFigure): number[] =>
  responses.flatMap((r) => {
    const value = r.fees[figure];
    return value === null ? [] : [value];
  });

/** Every fee, for everyone and for each group in each cut. */
export function results(responses: readonly FeeAnswers[]): FigureResult[] {
  return FEE_FIGURES.map((figure): FigureResult => {
    const everyone = spread(given(responses, figure));
    if (!everyone) return { figure, everyone: null };
    const cuts = CUTS.map((cut) => ({
      title: cut.title,
      groups: cut.groups.map((g) => ({ label: g.label, spread: spread(given(responses.filter(g.has), figure)) })),
    }));
    const tops = cuts.flatMap((c) => c.groups.map((g) => g.spread?.p75 ?? 0));
    return { figure, everyone, cuts, scale: niceCeiling(Math.max(everyone.p75, ...tops)) };
  });
}

const COLUMNS: Readonly<Record<FeeFigure, string>> = { hourly: 'hourly', bookkeeping: 'bookkeeping', taxReturn: 'tax_return' };

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const figureOf = (row: Row, column: string): number | null => (row[column] === null ? null : integer(row, column));

const confidenceOf = (row: Row): Confidence => {
  const value = integer(row, 'confidence');
  const match = confidence.scale.find((c) => c === value);
  if (match === undefined) throw new TypeError(`confidence is ${value}`);
  return match;
};

const toResponse = (row: Row): FeeResponse => ({
  id: integer(row, 'id'),
  edition: integer(row, 'edition'),
  createdAt: text(row, 'created_at'),
  stage: oneOf(row, 'stage', feeChoices.stage.slugs),
  years: oneOf(row, 'years', feeChoices.years.slugs),
  team: oneOf(row, 'team', feeChoices.team.slugs),
  pricing: oneOf(row, 'pricing', feeChoices.pricing.slugs),
  state: oneOf(row, 'state', states),
  niche: integer(row, 'niche') === 1,
  confidence: confidenceOf(row),
  fees: { hourly: figureOf(row, COLUMNS.hourly), bookkeeping: figureOf(row, COLUMNS.bookkeeping), taxReturn: figureOf(row, COLUMNS.taxReturn) },
});

/** The anonymous fee survey: answers, the yearly editions they fall in, and the results a host publishes. */
export function createFees(db: Db, now: () => Date = () => new Date()) {
  const responseCount = (edition: number) => count(db.prepare('SELECT count(*) AS n FROM fee_responses WHERE edition = ?').get(edition));
  const publishedAt = (edition: number) => {
    const row = db.prepare('SELECT published_at FROM fee_editions WHERE edition = ?').get(edition);
    return row ? optionalText(row, 'published_at') : null;
  };

  const toEdition = (edition: number, responses: number, published: string | null): Edition => ({
    edition,
    responses,
    status: published !== null ? 'published' : edition === editionOf(now()) ? 'open' : 'closed',
    publishedAt: published,
    publishable: published === null && responses >= PUBLISH_MIN,
  });
  const editionIn = (year: number) => toEdition(year, responseCount(year), publishedAt(year));
  const answers = (year: number) => db.prepare('SELECT * FROM fee_responses WHERE edition = ? ORDER BY id').all(year).map(toResponse);

  return {
    /** This year's edition, the one new answers go into. */
    current: (): Edition => editionIn(editionOf(now())),

    /** Every edition with answers or a publication, and this year's even without either, newest first. */
    editions(): Edition[] {
      return db
        .prepare(
          `SELECT e.edition, (SELECT count(*) FROM fee_responses r WHERE r.edition = e.edition) AS n, f.published_at
           FROM (SELECT edition FROM fee_responses UNION SELECT edition FROM fee_editions UNION SELECT ?) e
           LEFT JOIN fee_editions f ON f.edition = e.edition
           ORDER BY e.edition DESC`,
        )
        .all(editionOf(now()))
        .map((row) => toEdition(integer(row, 'edition'), integer(row, 'n'), optionalText(row, 'published_at')));
    },

    /** Takes one person's answers into this year's edition, unless its results are already out. */
    respond(input: FeeAnswers): Result<{ readonly edition: number }, AnswerRefusal> {
      return attempt<{ readonly edition: number }, AnswerRefusal>(db, (refuse) => {
        const at = now();
        const year = editionOf(at);
        if (publishedAt(year) !== null) refuse('closed');
        db.prepare(
          `INSERT INTO fee_responses (edition, created_at, stage, years, state, team, niche, pricing, ${COLUMNS.hourly}, ${COLUMNS.bookkeeping}, ${COLUMNS.taxReturn}, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(year, iso(at), input.stage, input.years, input.state, input.team, input.niche ? 1 : 0, input.pricing, input.fees.hourly, input.fees.bookkeeping, input.fees.taxReturn, input.confidence);
        return { edition: year };
      });
    },

    /** Puts an edition's results up and stops it taking answers. Publishing again keeps the first date. */
    publish(year: number, by: number): Result<Edition, PublishRefusal> {
      return attempt<Edition, PublishRefusal>(db, (refuse) => {
        if (responseCount(year) < PUBLISH_MIN) refuse('too-few');
        db.prepare(
          `INSERT INTO fee_editions (edition, published_at, published_by) VALUES (?, ?, ?)
           ON CONFLICT (edition) DO UPDATE SET published_at = excluded.published_at, published_by = excluded.published_by WHERE published_at IS NULL`,
        ).run(year, iso(now()), by);
        return editionIn(year);
      });
    },

    /** Takes an edition's results down. This year's starts taking answers again. */
    unpublish(year: number): Edition {
      db.prepare('UPDATE fee_editions SET published_at = NULL, published_by = NULL WHERE edition = ?').run(year);
      return editionIn(year);
    },

    /** An edition's results, published or not. Only a host may see an unpublished one; the page decides. */
    report(year: number): Report {
      const all = answers(year);
      return { edition: year, responses: all.length, publishedAt: publishedAt(year), figures: results(all) };
    },

    /** One page of an edition's answers, newest first, each with the figures that look out of place. */
    review(year: number, page: { limit: number; offset: number }): { items: ReviewedResponse[]; total: number } {
      const all = answers(year);
      const bounds = FEE_FIGURES.map((figure) => ({ figure, fence: fences(given(all, figure)) }));
      const items = db
        .prepare('SELECT * FROM fee_responses WHERE edition = ? ORDER BY id DESC LIMIT ? OFFSET ?')
        .all(year, page.limit, page.offset)
        .map(toResponse)
        .map((r) => ({
          ...r,
          unusual: bounds.flatMap(({ figure, fence }) => {
            const value = r.fees[figure];
            return fence && value !== null && (value < fence.low || value > fence.high) ? [figure] : [];
          }),
        }));
      return { items, total: all.length };
    },

    /** Every answer in an edition, oldest first, for a host's spreadsheet. */
    answers,

    /** Deletes one answer a host judged to be made up. False when it was already gone. */
    remove(id: number): boolean {
      return db.prepare('DELETE FROM fee_responses WHERE id = ?').run(id).changes > 0;
    },
  };
}
