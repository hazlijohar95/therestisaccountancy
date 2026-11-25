/*
 * The software the club makes. A product is an app with its own address, here or on its own domain, or a free tool
 * that works on the page. /products lists them all. Adding an app is one entry here.
 */

export type ProductKind = 'app' | 'tool';

export interface Product {
  readonly slug: string;
  readonly name: string;
  readonly kind: ProductKind;
  /** The question it answers, as the visitor would ask it. */
  readonly question: string;
  readonly summary: string;
  /** Its own page on this site, or its domain. */
  readonly href: `/${string}` | `https://${string}`;
}

export const products: readonly Product[] = [
  { slug: 'rate', name: 'Rate tool', kind: 'tool', href: '/tools/rate', question: 'What is my lowest fair rate?', summary: 'The hourly floor that pays your income and your running costs.' },
  { slug: 'planner', name: 'Practice planner', kind: 'tool', href: '/tools/planner', question: 'How many clients does that take?', summary: 'The clients you need, the sales calls a month to get there, and the month your hours run out.' },
  { slug: 'fees', name: 'Fee survey', kind: 'tool', href: '/fees', question: 'What do other practices charge?', summary: 'An anonymous yearly survey of fees in Malaysian practices, with the results public.' },
];

export const productsOf = (kind: ProductKind) => products.filter((p) => p.kind === kind);
