import type { z } from 'zod';
import type { Member } from '../../../src/server/club.ts';
import type { Letter } from '../../../src/server/letters.ts';
import { decide, refusal, type Actor, type Level, type Lookups } from './access.ts';
import { parsed, refused, type Outcome } from './outcome.ts';

/*
 * A form's server function, in one fixed order: who may act, then the input, then the throttle, then the work. A
 * visitor who may not act never learns what was wrong with the fields, and a post with a typo does not count against
 * the address. Framework-free: production and tests each bind an Adapter.
 */

/** The forms that take only a few posts a minute from one address. */
export type LimitedForm = 'join' | 'sign-in' | 'link' | 'checkout' | 'survey' | 'listing' | 'call' | 'newsletter' | 'social-sign-up' | 'social-request' | 'ticks' | 'work-email' | 'nominate' | 'decline' | 'floor' | 'report' | 'answer' | 'casebook' | 'shelf';

export const tooManyTries = 'Too many tries from here. Wait a minute and try again.';

/** What an action runs against. S is the store as this side reaches it. */
export interface Adapter<S extends Lookups> {
  /** Who is signed in for this request. */
  member(): Promise<Member | null>;
  /** Runs fn with the store open, and releases it after. */
  open<T>(fn: (store: S) => Promise<T>): Promise<T>;
  /** True when the form may take another post from where this one came from. */
  allow(store: S, form: LimitedForm): Promise<boolean>;
  /** Sends letters once the action has succeeded. */
  send(letters: readonly Letter[]): void;
}

export interface Spec<L extends Level, I extends z.ZodType, R extends string> {
  readonly access: L;
  readonly input: I;
  readonly limit?: LimitedForm;
  /** The message for each refusal the work may answer with. */
  readonly refusals?: Readonly<Record<R, string>>;
}

export interface Context<L extends Level, I extends z.ZodType, S> {
  readonly actor: Actor<L>;
  readonly input: z.output<I>;
  readonly store: S;
  /** Queues letters. They go only if the action succeeds. */
  send(letters: readonly Letter[]): void;
}

/** A domain module's refusal, which the spec's table turns into a message. */
type Failed<R extends string> = { readonly ok: false; readonly reason: R };

/** The action function for one side of the seam. */
export function createAction<S extends Lookups>(adapter: Adapter<S>) {
  return function action<L extends Level, I extends z.ZodType, T, R extends string = never>(
    spec: Spec<L, I, R>,
    work: (context: Context<L, I, S>) => Promise<Outcome<T> | Failed<NoInfer<R>>>,
  ) {
    return async ({ data }: { readonly data: unknown }): Promise<Outcome<T>> => {
      const member = await adapter.member();
      return adapter.open(async (store) => {
        const decision = await decide(spec.access, member, store);
        if (!decision.ok) return refusal(decision.denial);
        const input = await parsed(spec.input, data);
        if (!input.ok) return input;
        if (spec.limit && !(await adapter.allow(store, spec.limit))) return refused(tooManyTries);
        const letters: Letter[] = [];
        const answer = await work({ actor: decision.actor, input: input.value, store, send: (more) => letters.push(...more) });
        const outcome = settled(answer, spec.refusals);
        if (outcome.ok) adapter.send(letters);
        return outcome;
      });
    };
  };
}

function settled<T, R extends string>(answer: Outcome<T> | Failed<R>, refusals: Readonly<Record<R, string>> | undefined): Outcome<T> {
  if (answer.ok || !('reason' in answer)) return answer;
  const message = refusals?.[answer.reason];
  if (message === undefined) throw new Error(`No message for the refusal '${answer.reason}'.`);
  return refused(message);
}
