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

/**
 * What a handle looks like on each platform, lowercased, and the address of its profile. Reviewers open that address
 * to look for the code, so a handle that does not fit the pattern never becomes a link.
 */
export const PLATFORM_PROFILES = {
  LinkedIn: { pattern: /^[a-z0-9-]{3,100}$/, url: (handle: string) => `https://www.linkedin.com/in/${handle}/` },
  Threads: { pattern: /^[a-z0-9._]{1,30}$/, url: (handle: string) => `https://www.threads.com/@${handle}` },
  X: { pattern: /^[a-z0-9_]{1,15}$/, url: (handle: string) => `https://x.com/${handle}` },
  TikTok: { pattern: /^[a-z0-9._]{2,24}$/, url: (handle: string) => `https://www.tiktok.com/@${handle}` },
  YouTube: { pattern: /^[a-z0-9._-]{3,30}$/, url: (handle: string) => `https://www.youtube.com/@${handle}` },
  Instagram: { pattern: /^[a-z0-9._]{1,30}$/, url: (handle: string) => `https://www.instagram.com/${handle}/` },
} as const satisfies Record<Platform, { pattern: RegExp; url: (handle: string) => string }>;

/**
 * A handle as people type or paste it: any case, with or without the @, or the profile's address. Returns the bare
 * handle, lowercased; whether it fits the platform is a separate check.
 */
export function accountHandle(raw: string): string {
  const typed = raw.trim();
  const path = URL.canParse(typed) ? new URL(typed).pathname : /^(www\.)?[a-z0-9.-]+\.[a-z]{2,}\//i.test(typed) ? typed.replace(/^[^/]+/, '') : null;
  const last = path === null ? typed : (path.split('/').filter(Boolean).at(-1) ?? '');
  return last.replace(/^@/, '').toLowerCase();
}

/** A status a body grants, and the track a ticked claim at that status puts someone on. Exact names: we never round up. */
interface BodyStatus {
  readonly name: string;
  readonly track: 'qualified' | 'training';
}
const training = (name: string): BodyStatus => ({ name, track: 'training' });
const qualified = (name: string): BodyStatus => ({ name, track: 'qualified' });

/** Each body, with its website for the team checking a claim. 'other' is any body not listed: its claims need a document. */
export const BODIES = [
  { id: 'mia', name: 'MIA', region: 'MY', site: 'https://www.mia.org.my', statuses: [qualified('Member'), qualified('Chartered Accountant')] },
  { id: 'micpa', name: 'MICPA', region: 'MY', site: 'https://www.micpa.com.my', statuses: [qualified('Member')] },
  { id: 'ctim', name: 'CTIM', region: 'MY', site: 'https://www.ctim.org.my', statuses: [training('Student'), qualified('Associate'), qualified('Fellow')] },
  { id: 'maicsa', name: 'MAICSA', region: 'MY', site: 'https://www.maicsa.org.my', statuses: [training('Student'), qualified('Associate'), qualified('Fellow')] },
  { id: 'isca', name: 'ISCA', region: 'SG', site: 'https://isca.org.sg', statuses: [qualified('Member'), qualified('CA (Singapore)')] },
  { id: 'acca', name: 'ACCA', region: 'Global', site: 'https://www.accaglobal.com', statuses: [training('Student'), training('Affiliate'), qualified('Member'), qualified('Fellow')] },
  { id: 'cpaa', name: 'CPA Australia', region: 'Global', site: 'https://www.cpaaustralia.com.au', statuses: [qualified('Associate'), qualified('CPA'), qualified('FCPA')] },
  { id: 'icaew', name: 'ICAEW', region: 'Global', site: 'https://www.icaew.com', statuses: [training('Student'), qualified('ACA'), qualified('FCA')] },
  { id: 'cima', name: 'CIMA', region: 'Global', site: 'https://www.aicpa-cima.com', statuses: [training('Student'), qualified('ACMA'), qualified('FCMA')] },
  { id: 'caanz', name: 'CA ANZ', region: 'Global', site: 'https://www.charteredaccountantsanz.com', statuses: [training('Provisional'), qualified('CA'), qualified('FCA')] },
  { id: 'cipfa', name: 'CIPFA', region: 'Global', site: 'https://www.cipfa.org', statuses: [training('Student'), qualified('Member')] },
  { id: 'other', name: 'Another body', region: 'Any', site: null, statuses: [training('Student'), qualified('Member'), qualified('Fellow')] },
] as const satisfies readonly { id: string; name: string; region: string; site: string | null; statuses: readonly BodyStatus[] }[];
export type Body = (typeof BODIES)[number];
export type BodyId = Body['id'];
export const BODY_IDS = BODIES.map((body) => body.id);

export const bodyById = (id: string): Body | undefined => BODIES.find((body) => body.id === id);

/** The track a ticked claim at this status puts someone on. Null for a status the body does not grant. */
export function statusTrack(bodyId: string, status: string): 'qualified' | 'training' | null {
  const found: BodyStatus | undefined = bodyById(bodyId)?.statuses.find((s) => s.name === status);
  return found?.track ?? null;
}

/** Licences a member can hold. Each is checked from a document they upload, and lapses at the end of the month it runs to. */
export const LICENCES = ['Practising certificate', 'Approved company auditor', 'Licensed tax agent', 'Licensed company secretary'] as const;
export type Licence = (typeof LICENCES)[number];

/**
 * Addresses anyone can open, so a link sent there proves nothing about an employer. The work-email check refuses them.
 * Local ISPs are here too: streamyx and tm.net.my addresses are personal.
 */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.my', 'yahoo.com.sg', 'ymail.com', 'rocketmail.com', 'hotmail.com',
  'hotmail.my', 'outlook.com', 'outlook.my', 'live.com', 'live.com.my', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'zoho.com', 'zohomail.com', 'qq.com',
  '163.com', '126.com', 'tutanota.com', 'tuta.io', 'hey.com', 'fastmail.com', 'streamyx.com', 'tm.net.my',
]);

/** Claim field limits, shared by the forms and the server. Evidence is a PDF or a photo up to 5 MB. */
export const CLAIM_LIMITS = { reference: 60, otherBody: 80, label: 120, url: 300, reason: 300, evidenceBytes: 5 * 1024 * 1024 } as const;

/** Peers it takes to tick an experience claim. */
export const VOUCHES_TO_TICK = 3;

/** Days before a tick lapses when its member is reminded. Once each, nearest last. */
export const RENEWAL_REMINDER_DAYS = [60, 14] as const;

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
  account: { glyph: 't-account', name: 'Account proven', means: 'Someone on the team saw our code in that account’s bio.' },
  register: { glyph: 't-register', name: 'Agreed to register', means: 'Someone on the team matched it to a public record: the body’s register, a staff page or ORCID.' },
  document: { glyph: 't-document', name: 'Document sighted', means: 'Someone on the team read the certificate or licence. The file is deleted after.' },
  email: { glyph: 't-email', name: 'Work email confirmed', means: 'They clicked a link sent to the employer’s domain.' },
  vouch: { glyph: 't-vouch', name: 'Vouched by peers', means: 'Ticked colleagues confirmed it, on the record.' },
  self: { glyph: 't-self', name: 'Self-declared', means: 'Their word. Not checked yet.' },
} as const;
export type TickSource = keyof typeof TICK_SOURCES;
