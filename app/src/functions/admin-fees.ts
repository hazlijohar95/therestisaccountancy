import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { FEE_FIGURES, feeChoices, feeFigures, PUBLISH_MIN } from '../../../src/data/fees.ts';
import { formatDay } from '../../../src/lib/format.ts';
import { pageCount } from '../../../src/lib/paging.ts';
import type { Edition, PublishRefusal } from '../../../src/server/fees.ts';
import { id } from '../lib/fields.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';
import { pagingFor } from './admin.server.ts';

const PAGE_SIZE = 50;

const publishRefusals: Record<PublishRefusal, string> = {
  'too-few': `A year needs ${PUBLISH_MIN} answers before its results can go up.`,
};

const status = (e: Edition) =>
  e.status === 'published' && e.publishedAt
    ? `Published ${formatDay(e.publishedAt)}. Takes no more answers.`
    : `${e.status === 'open' ? 'Taking answers.' : 'Closed. Not published.'} ${e.publishable ? 'Ready to publish.' : `Needs ${PUBLISH_MIN - e.responses} more to publish.`}`;

const rm = (n: number | null) => (n === null ? '' : `RM ${n.toLocaleString('en-MY')}`);

export interface FeesSearch {
  readonly edition?: number | undefined;
  readonly page?: number | undefined;
}

/** Every year of the survey, and one page of the asked year's answers with the unusual figures marked. */
export const adminFees = createServerFn({ method: 'GET' })
  .validator((input: FeesSearch) => input)
  .handler(async ({ data }) => {
    await admit('admin', toClub);
    const paging = pagingFor(data.page, PAGE_SIZE);
    const { editions, shown, items, total } = await withStore(async (store) => {
      const current = await store.fees.current();
      const editions = await store.fees.editions();
      const shown = editions.find((e) => e.edition === data.edition) ?? current;
      const { items, total } = await store.fees.review(shown.edition, { limit: paging.size, offset: paging.offset });
      return { editions, shown, items, total };
    });
    return {
      shown: shown.edition,
      page: paging.page,
      pages: pageCount(total, paging.size),
      publishMin: PUBLISH_MIN,
      figures: FEE_FIGURES.map((figure) => feeFigures[figure].label),
      editions: editions.map((e) => ({ edition: e.edition, responses: e.responses, published: e.status === 'published', publishable: e.publishable, status: status(e) })),
      answers: items.map((r) => ({
        id: r.id,
        received: formatDay(r.createdAt),
        practice: `${feeChoices.stage.labelOf(r.stage)}. ${feeChoices.years.labelOf(r.years)} in practice. ${feeChoices.team.labelOf(r.team)} in the team. ${r.state}. ${r.niche ? 'Serves a niche.' : 'Generalist.'}`,
        pricing: feeChoices.pricing.labelOf(r.pricing),
        fees: FEE_FIGURES.map((figure) => ({ figure, text: rm(r.fees[figure]), unusual: r.unusual.includes(figure) })),
        confidence: r.confidence,
      })),
    };
  });

const editionInput = z.object({ edition: id });

/** Puts a year's results up on the fee survey page. */
export const publishFees = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof editionInput>) => input)
  .handler(
    action({ access: 'admin', input: editionInput, refusals: publishRefusals }, async ({ actor, input, store }) => {
      const result = await store.fees.publish(input.edition, actor.id);
      return result.ok ? done({ edition: result.value.edition }) : result;
    }),
  );

/** Takes a year's results down. This year's then takes answers again. */
export const unpublishFees = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof editionInput>) => input)
  .handler(
    action({ access: 'admin', input: editionInput }, async ({ input, store }) => {
      const edition = await store.fees.unpublish(input.edition);
      return done({ edition: edition.edition, reopened: edition.status === 'open' });
    }),
  );

const answerInput = z.object({ answer: id });

/** Deletes an answer that is plainly made up, so it no longer counts. */
export const deleteFeeResponse = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof answerInput>) => input)
  .handler(
    action({ access: 'admin', input: answerInput }, async ({ input, store }) => {
      const removed = await store.fees.remove(input.answer);
      return removed ? done(null) : refused('That answer is already gone.');
    }),
  );
