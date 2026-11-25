/**
 * The community's channels. A fixed list: adding one is a line here. Threads store the slug, so renaming or removing
 * a slug needs a migration that moves its threads first; an unknown slug in the database is treated as corrupt data.
 */
export const channels = [
  { slug: 'introductions', name: 'Introductions', about: 'Who you are, where your practice stands, and what you want from the club.' },
  { slug: 'pricing', name: 'Pricing and proposals', about: 'Rates, packages, proposals, and the conversation where you say the number.' },
  { slug: 'clients', name: 'Clients and scope', about: 'Finding them, onboarding them, scope creep, and letting the wrong ones go.' },
  { slug: 'tools', name: 'Tools and AI', about: 'Software, workflows and automation that save hours, and the ones that did not.' },
  { slug: 'wins', name: 'Wins', about: 'A raised rate, a better client, a month that closed on time. Say it here.' },
  { slug: 'questions', name: 'Open questions', about: 'Anything else: compliance, hiring, the odd client, the odd deadline.' },
] as const;

export type ChannelSlug = (typeof channels)[number]['slug'];
export type Channel = (typeof channels)[number];

export const channelSlugs: readonly ChannelSlug[] = channels.map((c) => c.slug);
export const channelBySlug = (slug: string): Channel | undefined => channels.find((c) => c.slug === slug);
export const isChannelSlug = (slug: string): slug is ChannelSlug => channelBySlug(slug) !== undefined;
export const channelPath = (slug: ChannelSlug) => `/members/community/${slug}`;
export const threadPath = (id: number, page = 1) => `/members/community/threads/${id}${page > 1 ? `?page=${page}` : ''}`;

export const LIMITS = { title: { min: 3, max: 120 }, body: { max: 10_000 } } as const;
export const PAGE_SIZE = { threads: 30, posts: 50 } as const;
