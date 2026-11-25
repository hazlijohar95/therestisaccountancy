/* The directory's fixed lists. Listings store the slugs, so a slug never changes once listings use it. */

/** Malaysia's thirteen states and three federal territories, in alphabetical order. */
export const states = [
  'Johor',
  'Kedah',
  'Kelantan',
  'Kuala Lumpur',
  'Labuan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Perak',
  'Perlis',
  'Pulau Pinang',
  'Putrajaya',
  'Sabah',
  'Sarawak',
  'Selangor',
  'Terengganu',
] as const;
export type State = (typeof states)[number];

export const services = [
  { slug: 'bookkeeping', label: 'Bookkeeping' },
  { slug: 'management-accounts', label: 'Management accounts' },
  { slug: 'payroll', label: 'Payroll' },
  { slug: 'company-tax', label: 'Company tax' },
  { slug: 'personal-tax', label: 'Personal tax' },
  { slug: 'sst', label: 'SST' },
  { slug: 'e-invoicing', label: 'e-Invoicing' },
  { slug: 'audit', label: 'Audit' },
  { slug: 'secretarial', label: 'Company secretarial' },
  { slug: 'advisory', label: 'Advisory and forecasting' },
  { slug: 'setup', label: 'Starting a business' },
] as const;
export type Service = (typeof services)[number];
export type ServiceSlug = Service['slug'];

export const LISTING_LIMITS = {
  practice: 80,
  town: 60,
  niche: 80,
  bio: 500,
  qualifications: 160,
  note: 500,
} as const;
