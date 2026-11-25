import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { states } from '../data/directory.ts';
import { confidence, FEE_FIGURES, feeChoices, feeFigures, PUBLISH_MIN, type FeeFigure } from '../data/fees.ts';
import type { AnswerRefusal, PublishRefusal } from '../server/fees.ts';
import { admin, id, settle, throttle, type Refusal } from './guards.ts';

const ringgit = (n: number) => `RM ${n.toLocaleString('en-MY')}`;

const picked = <const S extends string>(slugs: readonly S[], message = 'Choose one.') => z.enum(slugs, { error: message });

/** A fee in whole ringgit, inside its bounds, or left blank. */
const fee = (figure: FeeFigure) => {
  const { min, max } = feeFigures[figure];
  const message = `Enter whole ringgit from ${ringgit(min)} to ${ringgit(max)}, or leave it blank.`;
  return z.number({ error: message }).int(message).min(min, message).max(max, message).optional();
};

const scaleMessage = 'Choose a number from 1 to 5.';

const answerRefusals: Record<AnswerRefusal, Refusal> = {
  closed: { code: 'CONFLICT', message: "This year's results are out, so the survey has closed. Next year's opens on 1 January." },
};

const publishRefusals: Record<PublishRefusal, Refusal> = {
  'too-few': { code: 'BAD_REQUEST', message: `A year needs ${PUBLISH_MIN} answers before its results can go up.` },
};

const edition = z.object({ edition: z.coerce.number().int().positive() });

export const fees = {
  answerFeeSurvey: defineAction({
    accept: 'form',
    input: z
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
      .refine((v) => FEE_FIGURES.some((figure) => v[figure] !== undefined), { message: 'Give at least one of the three fees.', path: ['fees'] }),
    handler: async ({ trap, niche, hourly, bookkeeping, taxReturn, ...answers }, context) => {
      await throttle(context, 'survey');
      if (trap) return { answered: true };
      const result = await context.locals.fees.respond({
        ...answers,
        niche: niche === 'yes',
        fees: { hourly: hourly ?? null, bookkeeping: bookkeeping ?? null, taxReturn: taxReturn ?? null },
      });
      settle(result, answerRefusals);
      return { answered: true };
    },
  }),

  publishFees: defineAction({
    accept: 'form',
    input: edition,
    handler: async (input, context) => {
      const host = admin(context.locals);
      return settle(await context.locals.fees.publish(input.edition, host.id), publishRefusals);
    },
  }),

  unpublishFees: defineAction({
    accept: 'form',
    input: edition,
    handler: async (input, context) => {
      admin(context.locals);
      return context.locals.fees.unpublish(input.edition);
    },
  }),

  deleteFeeResponse: defineAction({
    accept: 'form',
    input: z.object({ answer: id }),
    handler: async (input, context) => {
      admin(context.locals);
      if (!(await context.locals.fees.remove(input.answer))) throw new ActionError({ code: 'NOT_FOUND', message: 'That answer is already gone.' });
      return { deleted: true };
    },
  }),
};
