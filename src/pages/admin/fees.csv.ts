import type { APIRoute } from 'astro';
import { FEE_FIGURES, feeChoices, feeFigures } from '../../data/fees.ts';
import { csv } from '../../lib/csv.ts';

export const prerender = false;

/* The day only: the time adds nothing to a host's check and would make a row easier to tie to a person. */
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });

/** One year's answers as a spreadsheet, for a host to check or work with. ?edition=2026, or this year when left out. */
export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.member?.role !== 'admin') return new Response(null, { status: 403 });
  const asked = url.searchParams.get('edition');
  if (asked !== null && !/^\d{4}$/.test(asked)) return new Response('Name the year as ?edition=2026.', { status: 400 });
  const edition = asked === null ? (await locals.fees.current()).edition : Number(asked);
  const answers = await locals.fees.answers(edition);
  const rows = [
    ['Received', 'Stage', 'Years in practice', 'Team', 'State', 'Niche', 'Pricing', ...FEE_FIGURES.map((f) => `${feeFigures[f].label} (RM)`), 'Sure of their prices (1 to 5)'],
    ...answers.map((r) => [
      day.format(new Date(r.createdAt)),
      feeChoices.stage.labelOf(r.stage),
      feeChoices.years.labelOf(r.years),
      feeChoices.team.labelOf(r.team),
      r.state,
      r.niche ? 'Yes' : 'No',
      feeChoices.pricing.labelOf(r.pricing),
      ...FEE_FIGURES.map((f) => String(r.fees[f] ?? '')),
      String(r.confidence),
    ]),
  ];
  return new Response(csv(rows), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="fee-survey-${edition}.csv"`, 'cache-control': 'no-store' },
  });
};
