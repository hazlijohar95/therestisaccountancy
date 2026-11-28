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

/**
 * Who may open a room: anyone, someone with a ticked practising licence, or the club's paying members. The team opens
 * every room.
 */
export const ROOM_ACCESS = ['anyone', 'licensed', 'club'] as const;
export type RoomAccess = (typeof ROOM_ACCESS)[number];
/** Why a room is shut to someone: the access it needs that they lack. */
export type RoomLock = Exclude<RoomAccess, 'anyone'>;

/** Rooms on the Floor. The members' room is the club's own, for members while their membership is paid. */
export const ROOMS = [
  { id: 'open', name: 'Open floor', access: 'anyone' },
  { id: 'study', name: 'Study hall', access: 'anyone' },
  { id: 'tax-my', name: 'Tax · Malaysia', access: 'anyone' },
  { id: 'audit', name: 'Audit', access: 'anyone' },
  { id: 'careers', name: 'Careers', access: 'anyone' },
  { id: 'practice', name: 'Practitioners’ room', access: 'licensed' },
  { id: 'club', name: 'Members’ room', access: 'club' },
] as const satisfies readonly { id: string; name: string; access: RoomAccess }[];
export type Room = (typeof ROOMS)[number];
export type RoomId = Room['id'];
export const ROOM_IDS = ROOMS.map((room) => room.id);

export function roomOf(id: RoomId): Room {
  const found = ROOMS.find((room) => room.id === id);
  if (!found) throw new TypeError(`${id} is not a room`);
  return found;
}

/** A room's feed, as a social path. */
export const roomPath = (id: RoomId) => `/?room=${id}`;

/** A post's jurisdiction: one we know, or 'Any' when the answer does not change at the border. */
export const POST_JURISDICTIONS = ['MY', 'SG', 'AU', 'UK', 'Any'] as const;
export type PostJurisdiction = (typeof POST_JURISDICTIONS)[number];

/** Post and reply limits, shared by the forms and the server. Authors can edit for the first quarter hour. */
export const FLOOR_LIMITS = { titleMin: 8, title: 140, body: 10_000, editMinutes: 15, pageSize: 20 } as const;

/** The Floor's filters, beside the rooms. */
export const FEED_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'following', label: 'Following' },
  { id: 'ticked', label: 'Ticked answers' },
  { id: 'MY', label: 'MY' },
  { id: 'SG', label: 'SG' },
  { id: 'AU', label: 'AU' },
  { id: 'UK', label: 'UK' },
  { id: 'Any', label: 'Any' },
] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number]['id'];

/** What can be reported, and why. A person on the team reads every report. */
export const REPORT_TARGETS = ['post', 'reply', 'profile'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export const REPORT_REASONS = [
  { id: 'client', label: 'It names a client or shares their details', on: ['post', 'reply'] },
  { id: 'wrong-claim', label: 'A claim is wrong', on: ['profile'] },
  { id: 'impersonation', label: 'Pretending to be someone', on: ['profile'] },
  { id: 'its-me', label: 'This is me. Take it down.', on: ['profile'] },
  { id: 'spam', label: 'Spam or selling', on: ['post', 'reply', 'profile'] },
  { id: 'abuse', label: 'Harassment or abuse', on: ['post', 'reply', 'profile'] },
] as const satisfies readonly { id: string; label: string; on: readonly ReportTarget[] }[];
export type ReportReason = (typeof REPORT_REASONS)[number]['id'];
export const REPORT_REASON_IDS = REPORT_REASONS.map((reason) => reason.id);
export const reasonsFor = (target: ReportTarget) => REPORT_REASONS.filter((reason) => reason.on.some((on) => on === target));
export const REPORT_NOTE_MAX = 500;

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
  'request', 'invite', 'invites', 'join',
  'welcome', 'settings', 'account', 'about', 'privacy', 'terms', 'null', 'undefined', 'anonymous', 'everyone', 'you',
  'therestisaccountancy', 'tria', 'sticktoaccounting',
]);

/** A handle as people type it: any case, with or without the @. */
export const normaliseHandle = (raw: string) => raw.trim().replace(/^@/, '').toLowerCase();

/** Why a normalised handle cannot be used, before asking whether someone holds it. Null when it can. */
export function handleProblem(handle: string): 'handle-invalid' | 'handle-reserved' | null {
  if (!HANDLE.pattern.test(handle)) return 'handle-invalid';
  return RESERVED_HANDLES.has(handle) ? 'handle-reserved' : null;
}

/** Said beside the handle field wherever someone picks one. */
export const HANDLE_TAKEN = 'Someone already has that handle. Pick another.';

/** Profile field limits, shared by the form and the server. */
export const PROFILE_LIMITS = { headline: 120, city: 60 } as const;

/**
 * How a Social account got in. Social is invite-only: the team's invite, a member's invite, a nomination the nominee
 * claimed, the club (any member it accepted), or a request the team approved. 'open' is everyone who joined before.
 */
export const ENTRY_VIA = ['open', 'team', 'member', 'nomination', 'club', 'request'] as const;
export type EntryVia = (typeof ENTRY_VIA)[number];

/** An invite link works once, for this long. */
export const INVITE_DAYS = 14;
/** Invites each member with a ticked credential may have out or used. Revoking or letting one expire returns it. */
export const MEMBER_INVITES = 3;
/** What a request to join says. */
export const REQUEST_LIMITS = { about: 200, link: 300 } as const;

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

/** A weekly problem's options carry these letters, in order. */
export const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

/** Problem and answer limits, shared by the forms and the server. */
export const PROBLEM_LIMITS = { title: 140, line: 300, ask: 300, option: 200, reasoning: 1000, scenario: { min: 2, max: 4 }, options: { min: 2, max: 4 } } as const;

/** What a member with the seal says about another member's reasoning. */
export const RATINGS = [
  { id: 'sound', label: 'Sound' },
  { id: 'partly', label: 'Partly' },
  { id: 'unsound', label: 'Unsound' },
] as const;
export type Rating = (typeof RATINGS)[number]['id'];
export const RATING_IDS = RATINGS.map((rating) => rating.id);

/** Casebook entries: the kind of work, never the client. Bands and years only. */
export const SERVICES = ['Audit', 'Tax', 'Reporting', 'Advisory', 'FP&A', 'Co sec'] as const;
export type Service = (typeof SERVICES)[number];
export const INDUSTRIES = ['Manufacturing', 'Plantation', 'Property', 'Retail', 'Tech', 'Financial services', 'Public sector', 'Non-profit'] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const BANDS = ['Under RM5m', 'RM5m–50m', 'RM50m–500m', 'Over RM500m'] as const;
export type Band = (typeof BANDS)[number];
export const FRAMEWORKS = ['MFRS', 'MPERS', 'IFRS', 'SFRS(I)', 'Tax law', 'Companies Act', 'Not applicable'] as const;
export type Framework = (typeof FRAMEWORKS)[number];
export const ENGAGEMENT_ROLES = ['Associate', 'Senior', 'Manager', 'Senior manager', 'Director', 'Partner', 'In-house'] as const;
export type EngagementRole = (typeof ENGAGEMENT_ROLES)[number];
export const AREAS = ['Revenue', 'Inventory', 'Going concern', 'Impairment', 'Leases', 'Deferred tax', 'Related parties', 'Consolidation', 'Transfer pricing'] as const;
export type Area = (typeof AREAS)[number];
/** The year an engagement ended: last year back to seven years ago, or earlier. A year that has not ended yet narrows it down. */
export const EARLIER = 'Earlier';
export const casebookYears = (now: Date): string[] => {
  const year = new Date(now.getTime() + 8 * 3_600_000).getUTCFullYear();
  return [...Array.from({ length: 7 }, (_, i) => String(year - 1 - i)), EARLIER];
};
export const CASEBOOK_LIMITS = { note: 300 } as const;

/** Roles on a member's timeline: the kind of employer, never its name. */
export const EMPLOYER_KINDS = ['Big Four firm', 'Mid-tier firm', 'Small practice', 'Own practice', 'Listed group', 'Private company', 'Multinational', 'Public sector', 'Non-profit', 'University', 'Other'] as const;
export type EmployerKind = (typeof EMPLOYER_KINDS)[number];
export const ROLE_LIMITS = { title: 80, earliest: 1960 } as const;

/** What a shelf item is. Members link to work they share in public; we never host the file. */
export const SHELF_KINDS = ['Template', 'Checklist', 'Explainer', 'Article', 'Video', 'Course', 'Tool'] as const;
export type ShelfKind = (typeof SHELF_KINDS)[number];
export const SHELF_LIMITS = { title: 140, url: 500, items: 30 } as const;
