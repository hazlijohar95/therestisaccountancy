/*
 * The club's lines of business, in one list. The header, the menu and the footer read it, so a new line is one entry
 * here. The paid unit every line leads to is membership: `join` in club.ts.
 */
import type { Link } from './club.ts';

export type LineGroup = 'Read' | 'Learn' | 'Build' | 'Work with us';

export interface Line extends Link {
  readonly group: LineGroup;
}

export const lines: readonly Line[] = [
  { href: '/newsletter', label: 'Newsletter', group: 'Read' },
  { href: '/podcast', label: 'Podcast', group: 'Read' },
  { href: '/programmes', label: 'Programmes', group: 'Learn' },
  { href: '/products', label: 'Products', group: 'Build' },
  { href: '/packs', label: 'Packs', group: 'Build' },
  { href: '/consulting', label: 'Consulting', group: 'Work with us' },
];

/** Pages that are not a line: in the menu after the lines, and in the footer under their group. */
export const company = {
  membership: { href: '/membership', label: 'Membership', group: 'Learn' },
  directory: { href: '/directory', label: 'Find an accountant', group: 'Work with us' },
  about: { href: '/about', label: 'About', group: 'Company' },
  privacy: { href: '/privacy', label: 'Privacy', group: 'Company' },
} as const satisfies Record<string, Link & { group: LineGroup | 'Company' }>;

const GROUPS = ['Read', 'Learn', 'Build', 'Work with us', 'Company'] as const;

/** The footer's columns: each group with its links, lines first. */
export const footerGroups = GROUPS.map((group) => ({
  group,
  links: [...lines, ...Object.values(company)].filter((link) => link.group === group),
}));
