/* The fee survey's questions and the rules for publishing its results. Responses store the option text, so an option
   is reworded only between editions. */
import { states } from './directory.ts';

export const feeOptions = {
  stage: ['I run my own practice', 'I am a partner in a firm', 'I set fees in a firm I work for'],
  years: ['Under 2 years', '2 to 5 years', '5 to 10 years', 'Over 10 years'],
  team: ['Just me', '2 to 5', '6 to 15', 'More than 15'],
  pricing: ['Mostly fixed fees', 'A mix', 'Mostly by the hour'],
  state: states,
} as const;

/** The one client every fee question is about, so answers compare like with like. */
export const standardClient = 'A small private limited company (Sdn Bhd) with about 100 transactions a month, one bank account and no payroll.';

/** Whole ringgit. Answers outside these are refused as typos. */
export const FEE_BOUNDS = {
  hourly: { min: 20, max: 2000 },
  bookkeeping: { min: 50, max: 20_000 },
  taxReturn: { min: 100, max: 50_000 },
} as const;

/** An edition can be published once it has this many responses, and only when a host publishes it. */
export const PUBLISH_MIN = 30;
/** A group smaller than this is never shown, so no one answer can be picked out. */
export const GROUP_MIN = 5;
