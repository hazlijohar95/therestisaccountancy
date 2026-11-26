/*
 * The club's lines of business, in one list. The header, the menu and the footer read it, so a new line is one entry
 * here. The paid unit every line leads to is membership: `join` in club.ts.
 */
import { signIn, type Link } from './club.ts';
import { site } from './site.ts';

export type LineGroup = 'Read' | 'Learn' | 'Build' | 'Work with us';

export interface Line extends Link {
  readonly group: LineGroup;
}

const newsletter: Line = { href: '/newsletter', label: 'Newsletter', group: 'Read' };
const podcast: Line = { href: '/podcast', label: 'Podcast', group: 'Read' };
const programmes: Line = { href: '/programmes', label: 'Programmes', group: 'Learn' };
const products: Line = { href: '/products', label: 'Products', group: 'Build' };
const packs: Line = { href: '/packs', label: 'Packs', group: 'Build' };
const consulting: Line = { href: '/consulting', label: 'Consulting', group: 'Work with us' };

export const lines: readonly Line[] = [newsletter, podcast, programmes, products, packs, consulting];

/** Pages that are not a line: in the menu after the lines, and in the footer under their group. */
export const company = {
  membership: { href: '/membership', label: 'Membership', group: 'Learn' },
  directory: { href: '/directory', label: 'Find an accountant', group: 'Work with us' },
  about: { href: '/about', label: 'About', group: 'Company' },
  privacy: { href: '/privacy', label: 'Privacy', group: 'Company' },
} as const satisfies Record<string, Link & { group: LineGroup | 'Company' }>;

/*
 * The header's menu, in its own order rather than the lines': home and the club first, then what to read, what to use,
 * what to learn and who to hire. Below it, the account and the company.
 */
export const menu = {
  primary: [
    { href: '/', label: 'Home' },
    company.membership,
    newsletter,
    { href: '/columns#people', label: 'People' },
    { href: '/columns', label: 'Columns' },
    podcast,
    products,
    packs,
    programmes,
    consulting,
    company.directory,
  ],
  secondary: [signIn, { href: '/search', label: 'Search' }, company.about, { href: `mailto:${site.inbox}`, label: 'Contact us' }],
} as const satisfies Record<string, readonly MenuLink[]>;

/** A menu entry: a page on the site, or the club's inbox. */
interface MenuLink {
  readonly href: Link['href'] | `mailto:${string}`;
  readonly label: string;
}

const GROUPS = ['Read', 'Learn', 'Build', 'Work with us', 'Company'] as const;

/** The footer's columns: each group with its links, lines first. */
export const footerGroups = GROUPS.map((group) => ({
  group,
  links: [...lines, ...Object.values(company)].filter((link) => link.group === group),
}));
