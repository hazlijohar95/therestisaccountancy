/* The programmes. Kept apart from the page copy because the content collections validate lessons against these slugs. */

export const programmeSlugs = ['foundations', 'pricing', 'clients', 'visibility', 'advisory', 'ai', 'growth'] as const;
export type ProgrammeSlug = (typeof programmeSlugs)[number];

export interface Programme {
  readonly slug: ProgrammeSlug;
  readonly name: string;
  readonly promise: string;
  /** The programme's modules, in teaching order. */
  readonly topics: readonly string[];
}

export const programmes: readonly Programme[] = [
  { slug: 'foundations', name: 'Foundations', promise: 'From qualified to trading.', topics: ['Firm structure and registration', 'Practising certificate and tax agent approval', 'Anti-money-laundering duties', 'Engagement letters and onboarding', 'Your first clients'] },
  { slug: 'pricing', name: 'Pricing', promise: 'Fixed fees, not hours.', topics: ['Your floor rate', 'Packages a client can compare', 'Repricing the clients you have', 'Saying the number out loud'] },
  { slug: 'clients', name: 'Clients', promise: 'Without the hard sell.', topics: ['The first call', 'Proposals that get signed', 'Follow-up without chasing', 'Referrals that keep coming'] },
  { slug: 'visibility', name: 'Visibility', promise: 'Known for one thing.', topics: ['Positioning and a niche', 'One idea, many formats', 'LinkedIn, talks and a letter', 'A website that answers questions'] },
  { slug: 'advisory', name: 'Advisory', promise: 'Beyond the annual return.', topics: ['Management accounts clients read', 'Budgets and cash forecasts', 'Tax planning through the year', 'Charging for advice'] },
  { slug: 'ai', name: 'AI', promise: 'Tools, with limits.', topics: ['Where AI helps a practice', 'Prompts and workflows', 'Client data and its boundaries', 'e-Invoicing and the new month-end'] },
  { slug: 'growth', name: 'Growth', promise: 'A firm, not a job.', topics: ['The firm you want in three years', 'A week that repeats', 'Systems before staff', 'Your first hire', 'The plan, written down'] },
];

export const programmePath = (p: Pick<Programme, 'slug'>) => `/programmes/${p.slug}` as const;
export const programmeAnchor = (p: Pick<Programme, 'slug'>) => `p-${p.slug}`;

export function programmeBySlug(slug: string): Programme | undefined {
  return programmes.find((p) => p.slug === slug);
}
