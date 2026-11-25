/* The fee survey's questions and the rules for publishing its results. Responses store the slugs, so a label can be
   reworded at any time, but a slug never changes once responses use it. */
import { states } from './directory.ts';

export interface Option<S extends string> {
  readonly slug: S;
  readonly label: string;
}

const choice = <const S extends string>(label: string, options: readonly Option<S>[]) => ({
  label,
  options,
  slugs: options.map((o) => o.slug),
  labelOf: (slug: S) => options.find((o) => o.slug === slug)?.label ?? slug,
});

/** The questions answered by picking one option. */
export const feeChoices = {
  stage: choice('Which is closest to you?', [
    { slug: 'own', label: 'I run my own practice' },
    { slug: 'partner', label: 'I am a partner in a firm' },
    { slug: 'employed', label: 'I set fees in a firm I work for' },
  ]),
  years: choice('How long have you been in practice?', [
    { slug: 'under-2', label: 'Under 2 years' },
    { slug: '2-4', label: '2 to 4 years' },
    { slug: '5-9', label: '5 to 9 years' },
    { slug: '10-plus', label: '10 years or more' },
  ]),
  team: choice('How many people work in the practice, you included?', [
    { slug: 'solo', label: 'Just me' },
    { slug: '2-5', label: '2 to 5' },
    { slug: '6-15', label: '6 to 15' },
    { slug: 'over-15', label: 'More than 15' },
  ]),
  niche: choice('Do you serve a niche?', [
    { slug: 'yes', label: 'Yes, a kind of client or an industry I am known for' },
    { slug: 'no', label: 'No, I take most kinds of client' },
  ]),
  pricing: choice('How do you price most of your work?', [
    { slug: 'fixed', label: 'Mostly fixed fees' },
    { slug: 'mix', label: 'A mix of fixed and hourly' },
    { slug: 'hourly', label: 'Mostly by the hour' },
  ]),
} as const;
export type ChoiceKey = keyof typeof feeChoices;
export type Choice<K extends ChoiceKey> = (typeof feeChoices)[K]['slugs'][number];

export const feeState = { label: 'Which state do you practise in?', options: states } as const;

export const confidence = {
  label: 'How sure are you that your prices are right?',
  hint: '1 is not sure at all. 5 is completely sure.',
  scale: [1, 2, 3, 4, 5],
  /** Reported in three bands rather than five scores, so each band can gather enough answers to show. */
  bands: [
    { label: 'Not sure (1 or 2)', from: 1, to: 2 },
    { label: 'In between (3)', from: 3, to: 3 },
    { label: 'Sure (4 or 5)', from: 4, to: 5 },
  ],
} as const;
export type Confidence = (typeof confidence.scale)[number];

/** The one client the fee questions are about, so answers compare like with like. */
export const standardClient = 'A small private limited company (Sdn Bhd) with about 100 transactions a month, one bank account and no payroll.';

export const FEE_FIGURES = ['hourly', 'bookkeeping', 'taxReturn'] as const;
export type FeeFigure = (typeof FEE_FIGURES)[number];

export interface FigureCopy {
  /** The name in the results. */
  readonly label: string;
  /** The question on the form. */
  readonly question: string;
  readonly hint: string;
  /** How often it is charged: "RM 150 an hour". */
  readonly per: string;
  /** Whole ringgit. An answer outside these is refused as a typo. */
  readonly min: number;
  readonly max: number;
}

/** The three fees asked about, in the order the form and the results show them. */
export const feeFigures: Readonly<Record<FeeFigure, FigureCopy>> = {
  hourly: {
    label: 'Hourly rate',
    question: 'Your hourly rate',
    hint: 'What an hour of your time costs a client like this. Answer even if you quote fixed fees.',
    per: 'an hour',
    min: 20,
    max: 2000,
  },
  bookkeeping: {
    label: 'Monthly bookkeeping',
    question: "Monthly fee for keeping this client’s books",
    hint: 'What you charge each month.',
    per: 'a month',
    min: 50,
    max: 20_000,
  },
  taxReturn: {
    label: 'Tax return and computation',
    question: "Annual fee for this client’s tax return and computation",
    hint: 'What you charge once a year.',
    per: 'a year',
    min: 100,
    max: 50_000,
  },
};

/** An edition can be published once it has this many responses, and only when a host publishes it. */
export const PUBLISH_MIN = 30;
/** A group smaller than this is never shown, so no one answer can be picked out. */
export const GROUP_MIN = 5;
