import { hostFirstName } from './authors.ts';
import { programmes } from './programmes.ts';

/*
 * A new member's first steps, in the order that gets the most out of the club soonest. The welcome email lists them
 * and the members' home tracks them, so both say the same thing.
 */

export const FIRST_STEPS = ['session', 'lesson', 'plan', 'call', 'listing'] as const;
export type FirstStep = (typeof FIRST_STEPS)[number];

export interface FirstStepCopy {
  readonly label: string;
  readonly detail: string;
  /** Where in the members' area to do it. */
  readonly path: string;
}

const first = programmes[0];

export const firstSteps: Record<FirstStep, FirstStepCopy> = {
  session: { label: 'Come to a live session', detail: 'Bring a real problem from your practice.', path: '/members/sessions' },
  lesson: { label: 'Finish a lesson', detail: first ? `Start with ${first.name}.` : 'Pick a programme.', path: first ? `/members/programmes/${first.slug}` : '/members' },
  plan: { label: 'Write your plan', detail: `The firm you want. ${hostFirstName} answers.`, path: '/members/plan' },
  call: { label: 'Book a one-to-one', detail: `A short call with ${hostFirstName}.`, path: '/members/calls' },
  listing: { label: 'Get listed', detail: 'Business owners find you in the directory.', path: '/members/listing' },
};

/** What the club knows a member has done, as far as the first steps go. */
export interface FirstStepsEvidence {
  readonly sessions: number;
  readonly lessons: number;
  readonly calls: number;
  /** Their plan has gone to the hosts, or been answered. A draft does not count. */
  readonly planSent: boolean;
  readonly listed: boolean;
}

export const doneSteps = (e: FirstStepsEvidence): Record<FirstStep, boolean> => ({
  session: e.sessions > 0,
  lesson: e.lessons > 0,
  plan: e.planSent,
  call: e.calls > 0,
  listing: e.listed,
});
