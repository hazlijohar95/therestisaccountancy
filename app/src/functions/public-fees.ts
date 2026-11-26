import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { states } from '../../../src/data/directory.ts';
import { confidence, FEE_FIGURES, feeChoices, feeFigures, type FeeFigure } from '../../../src/data/fees.ts';
import type { AnswerRefusal, Edition, Report } from '../../../src/server/fees.ts';
import { tooManyTries } from '../lib/action.ts';
import { allowed } from '../lib/limits.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/** The survey's state, the results to show and the other published years. */
export const feesPage = createServerFn({ method: 'GET' })
  .validator((input: { edition: number | undefined }) => input)
  .handler(async ({ data }): Promise<{ current: Edition; report: Report | null; otherYears: number[] }> => {
    const member = await currentMember();
    const host = member?.role === 'admin';
    return withStore(async (store) => {
      const current = await store.fees.current();
      const editions = await store.fees.editions();
      const published = editions.filter((e) => e.status === 'published');
      /* Hosts can open any year here to see what publishing it would show. Everyone else sees only published years. */
      const chosen = editions.find((e) => e.edition === data.edition && (e.status === 'published' || host)) ?? published[0];
      const report = chosen ? await store.fees.report(chosen.edition) : null;
      return { current, report, otherYears: published.filter((e) => e.edition !== report?.edition).map((e) => e.edition) };
    });
  });

const ringgit = (n: number) => `RM ${n.toLocaleString('en-MY')}`;

const picked = <const S extends string>(slugs: readonly S[], message = 'Choose one.') => z.enum(slugs, { error: message });

/** A blank field is a fee left out; anything else is read as a number. */
const blankOrNumber = (value: unknown) => (value === undefined || value === '' ? undefined : Number(value));

/** A fee in whole ringgit, inside its bounds, or left blank. */
const fee = (figure: FeeFigure) => {
  const { min, max } = feeFigures[figure];
  const message = `Enter whole ringgit from ${ringgit(min)} to ${ringgit(max)}, or leave it blank.`;
  return z.preprocess(blankOrNumber, z.number({ error: message }).int(message).min(min, message).max(max, message).optional());
};

const scaleMessage = 'Choose a number from 1 to 5.';

const answerRefusals: Record<AnswerRefusal, string> = {
  closed: "This year's results are out, so the survey has closed. Next year's opens on 1 January.",
};

const survey = z
  .object({
    stage: picked(feeChoices.stage.slugs),
    years: picked(feeChoices.years.slugs),
    team: picked(feeChoices.team.slugs),
    state: picked(states, 'Choose a state.'),
    niche: picked(feeChoices.niche.slugs, 'Choose yes or no.'),
    pricing: picked(feeChoices.pricing.slugs),
    hourly: fee('hourly'),
    bookkeeping: fee('bookkeeping'),
    taxReturn: fee('taxReturn'),
    confidence: z.coerce.number({ error: scaleMessage }).pipe(z.literal(confidence.scale, { error: scaleMessage })),
    /** A field people never see. Bots that fill every field get the same thanks and nothing is saved. */
    trap: z.string().optional(),
  })
  .refine((v) => FEE_FIGURES.some((figure) => v[figure] !== undefined), { message: 'Give at least one of the three fees.', path: ['fees'] });

/** Takes one person's anonymous answers into this year's survey. The form's fields arrive as the strings it holds. */
export const answerFeeSurvey = createServerFn({ method: 'POST' })
  .validator((input: Readonly<Record<string, string>>) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const input = await parsed(survey, data);
    if (!input.ok) return input;
    if (!(await allowed('survey'))) return refused(tooManyTries);
    const { trap, niche, hourly, bookkeeping, taxReturn, ...answers } = input.value;
    if (trap) return done(null);
    const result = await withStore(async (store) =>
      await store.fees.respond({ ...answers, niche: niche === 'yes', fees: { hourly: hourly ?? null, bookkeeping: bookkeeping ?? null, taxReturn: taxReturn ?? null } }),
    );
    return result.ok ? done(null) : refused(answerRefusals[result.reason]);
  });
