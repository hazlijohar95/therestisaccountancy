import { site } from './site.ts';

/*
 * Social: the public, free community at social.<domain>. These lists are what the code checks input against. Bodies own
 * their names and logos; we only write the name.
 */

/** The social host. Every place that needs it (the Worker's domains, allowed hosts, routing) reads it here. */
export const socialHost = `social.${site.domain}`;

/** Where someone stands in the profession, shown as flair beside their name. Worked out from their ticked claims. */
export const TRACKS = ['qualified', 'training', 'field', 'creator'] as const;
export type Track = (typeof TRACKS)[number];
export const trackNames = {
  qualified: 'Qualified',
  training: 'In training',
  field: 'In the field',
  creator: 'Creator',
} as const satisfies Record<Track, string>;

/** Platforms a member can prove an account on. */
export const PLATFORMS = ['LinkedIn', 'Threads', 'X', 'TikTok', 'YouTube', 'Instagram'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** A status a body grants, and the track a ticked claim at that status puts someone on. Exact names: we never round up. */
interface BodyStatus {
  readonly name: string;
  readonly track: 'qualified' | 'training';
}
const training = (name: string): BodyStatus => ({ name, track: 'training' });
const qualified = (name: string): BodyStatus => ({ name, track: 'qualified' });

export const BODIES = [
  { id: 'mia', name: 'MIA', region: 'MY', statuses: [qualified('Member'), qualified('Chartered Accountant')] },
  { id: 'micpa', name: 'MICPA', region: 'MY', statuses: [qualified('Member')] },
  { id: 'ctim', name: 'CTIM', region: 'MY', statuses: [training('Student'), qualified('Associate'), qualified('Fellow')] },
  { id: 'maicsa', name: 'MAICSA', region: 'MY', statuses: [training('Student'), qualified('Associate'), qualified('Fellow')] },
  { id: 'isca', name: 'ISCA', region: 'SG', statuses: [qualified('Member'), qualified('CA (Singapore)')] },
  { id: 'acca', name: 'ACCA', region: 'Global', statuses: [training('Student'), training('Affiliate'), qualified('Member'), qualified('Fellow')] },
  { id: 'cpaa', name: 'CPA Australia', region: 'Global', statuses: [qualified('Associate'), qualified('CPA'), qualified('FCPA')] },
  { id: 'icaew', name: 'ICAEW', region: 'Global', statuses: [training('Student'), qualified('ACA'), qualified('FCA')] },
  { id: 'cima', name: 'CIMA', region: 'Global', statuses: [training('Student'), qualified('ACMA'), qualified('FCMA')] },
  { id: 'caanz', name: 'CA ANZ', region: 'Global', statuses: [training('Provisional'), qualified('CA'), qualified('FCA')] },
  { id: 'cipfa', name: 'CIPFA', region: 'Global', statuses: [training('Student'), qualified('Member')] },
  { id: 'other', name: 'Another body', region: 'Any', statuses: [training('Student'), qualified('Member'), qualified('Fellow')] },
] as const satisfies readonly { id: string; name: string; region: string; statuses: readonly BodyStatus[] }[];
export type BodyId = (typeof BODIES)[number]['id'];

/** Rooms on the Floor. The practitioners' room needs a ticked practising licence. */
export const ROOMS = [
  { id: 'open', name: 'Open floor', locked: false },
  { id: 'study', name: 'Study hall', locked: false },
  { id: 'tax-my', name: 'Tax · Malaysia', locked: false },
  { id: 'audit', name: 'Audit', locked: false },
  { id: 'careers', name: 'Careers', locked: false },
  { id: 'practice', name: 'Practitioners’ room', locked: true },
] as const;
export type RoomId = (typeof ROOMS)[number]['id'];

/** What people post about. A profile picks any of these, and The List filters by them. */
export const TOPICS = ['Audit', 'Tax', 'Reporting', 'FP&A', 'Co sec', 'Careers', 'AI & tools'] as const;
export type Topic = (typeof TOPICS)[number];

/** Where a member works. */
export const SECTORS = ['Practice', 'Commercial', 'Academia', 'Public sector', 'Student'] as const;
export type Sector = (typeof SECTORS)[number];

/** Jurisdictions a member works in. Posts carry one too, or 'Any'. */
export const JURISDICTIONS = ['MY', 'SG', 'AU', 'UK'] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

/** Handles: lowercase letters, digits and underscores, 3 to 30 long. */
export const HANDLE = { min: 3, max: 30, pattern: /^[a-z0-9_]{3,30}$/ } as const;

/** Handles nobody can claim: page names, and names that would pass for the team speaking. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'team', 'staff', 'support', 'help', 'official', 'moderator', 'mod', 'review', 'root', 'system',
  'social', 'club', 'members', 'member', 'me', 'edit', 'verify', 'badge', 'nominate', 'claim', 'casebook', 'notifications',
  'ticks', 'tick', 'search', 'list', 'floor', 'problems', 'problem', 'post', 'posts', 'sign_up', 'signup', 'sign_in', 'signin',
  'welcome', 'settings', 'account', 'about', 'privacy', 'terms', 'null', 'undefined', 'anonymous', 'everyone', 'you',
  'therestisaccountancy', 'tria', 'sticktoaccounting',
]);

/** Profile field limits, shared by the form and the server. */
export const PROFILE_LIMITS = { headline: 120, city: 60 } as const;

/** How we know a claim is true. Each source has its own tick glyph, like an auditor's tickmark legend. */
export const TICK_SOURCES = {
  account: { glyph: 't-account', name: 'Account proven', means: 'They posted our code from that account.' },
  register: { glyph: 't-register', name: 'Agreed to register', means: 'Name and number match the body’s public register.' },
  document: { glyph: 't-document', name: 'Document sighted', means: 'Certificate or licence reviewed by us, then confirmed with the body.' },
  email: { glyph: 't-email', name: 'Work email confirmed', means: 'They clicked a link sent to the employer’s domain.' },
  vouch: { glyph: 't-vouch', name: 'Vouched by peers', means: 'Ticked colleagues confirmed it, on the record.' },
  self: { glyph: 't-self', name: 'Self-declared', means: 'Their word. Not checked yet.' },
} as const;
export type TickSource = keyof typeof TICK_SOURCES;
