/* The written plan a member sends the hosts, section by section. Answers are stored by slug, so a slug never changes
   once plans use it; headings and prompts can. A section that carries over starts the next plan with the answer from
   the last one, so a member only changes what has moved. The question does not: the hosts have answered it. */

export const planSections = [
  {
    slug: 'destination',
    heading: 'The firm in three years',
    prompt: 'Revenue, clients and who they are, who works with you, and the hours you work. Specific enough that you would know the day you got there.',
    carriesOver: true,
  },
  {
    slug: 'today',
    heading: 'Where it stands today',
    prompt: 'The same measures as they are now. What is working, and what is not.',
    carriesOver: true,
  },
  {
    slug: 'gaps',
    heading: 'What has to change',
    prompt: 'The three things between today and the firm you described: pricing, clients, capacity, skills, or something else.',
    carriesOver: true,
  },
  {
    slug: 'year',
    heading: 'The next twelve months',
    prompt: 'What will be true at the end of each quarter. One or two results you can measure, per quarter.',
    carriesOver: true,
  },
  {
    slug: 'first',
    heading: 'The first ninety days',
    prompt: 'What you will do, in order, starting this week. Who does each thing, and by when.',
    carriesOver: true,
  },
  {
    slug: 'question',
    heading: 'Your question for the hosts',
    prompt: 'The one thing you most want a second opinion on.',
    carriesOver: false,
  },
] as const;

export type PlanSection = (typeof planSections)[number];
export type PlanSectionSlug = PlanSection['slug'];

/** The longest answer one section takes, in characters. */
export const PLAN_ANSWER_MAX = 4000;
/** The longest reply a host can write. */
export const PLAN_REPLY_MAX = 10_000;
