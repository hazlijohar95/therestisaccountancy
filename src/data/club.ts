/* The copy shared across pages. Copy used by one page lives in that page.
   Programme details, session formats and the calculator's starting figures are drafts until the club confirms them. */
import type { RateInputs } from '../lib/rate.ts';
import { capitalised, numberWord } from '../lib/format.ts';
import { programmeBySlug, programmePath, programmes, type Programme, type ProgrammeSlug } from './programmes.ts';
import type { SessionKind } from './sessions.ts';
import { LINK_DAYS } from './links.ts';
import { authors } from './authors.ts';

export interface Link {
  readonly href: `/${string}` | `#${string}`;
  readonly label: string;
}

export interface Term {
  readonly term: string;
  readonly detail: string;
}

export { site } from './site.ts';

/** "seven programmes": the count, spelled out, so the copy follows the list. */
export const programmeCount = `${numberWord(programmes.length)} programmes`;
const ProgrammeCount = capitalised(programmeCount);

export const join: Link = { href: '/join', label: 'Request membership' };
export const signIn: Link = { href: '/sign-in', label: 'Sign in' };

const programme = (slug: ProgrammeSlug): Programme => {
  const found = programmeBySlug(slug);
  if (!found) throw new Error(`No programme ${slug}`);
  return found;
};
const toProgramme = (p: Programme): Link => ({ href: programmePath(p), label: p.name });

export interface Obstacle {
  readonly question: string;
  readonly answer: string;
  readonly leadsTo: Link;
}

export const stuck = {
  title: 'Where are you stuck?',
  intro: 'Pick the one that is true this week. Each has a place in the club.',
  obstacles: [
    { question: "I haven’t opened my practice yet.", leadsTo: toProgramme(programme('foundations')), answer: 'Foundations takes you from qualified to trading. Firm structure, your practising certificate, tax agent approval, anti-money-laundering duties, engagement letters and your first clients.' },
    { question: 'I charge too little, and I know it.', leadsTo: toProgramme(programme('pricing')), answer: 'Pricing moves you from hours to fixed fees. Work out your floor, build packages a client can compare, reprice the clients you already have and hold the number once you have said it.' },
    { question: "Enquiries come in. Clients don’t.", leadsTo: toProgramme(programme('clients')), answer: 'Clients covers the first call, the proposal and the follow-up, without turning into someone you would avoid.' },
    { question: 'Nobody knows my firm exists.', leadsTo: toProgramme(programme('visibility')), answer: "Visibility is a plan you can keep. Choose what you want to be known for, then turn one idea a week into a post, a letter and a talk. In your voice, not an agency’s." },
    { question: 'AI is doing the work I bill for.', leadsTo: toProgramme(programme('ai')), answer: "AI shows where the tools help a practice, where they don’t, and where client data must stay put. Prompts, workflows and safeguards, kept current as the tools change." },
    { question: 'I want to advise, not just file.', leadsTo: toProgramme(programme('advisory')), answer: 'Advisory turns compliance clients into advisory clients. Management accounts clients actually read, cash forecasts, tax planning through the year, and how to charge for all of it.' },
    { question: "I’m busy, but the firm isn’t growing.", leadsTo: toProgramme(programme('growth')), answer: 'Growth is about the firm itself: what you want it to be in three years, a week that repeats, systems before staff and your first hire. You finish with a written plan for that firm, read and answered by the hosts.' },
    { question: 'I make every decision alone.', leadsTo: { href: '/membership#room', label: 'The room' }, answer: 'That is what the room is for. Bring a quote, a client, a hire or a bad week. Better said in the room than decided alone.' },
  ] satisfies readonly Obstacle[],
} as const;

/** The obstacle that points at a programme, used as that programme's "sounds like you" line. */
export const obstacleFor = (p: Programme): Obstacle | undefined => stuck.obstacles.find((o) => o.leadsTo.href === programmePath(p));

export const room = {
  label: 'The room',
  title: "A partners’ meeting for firms of one.",
  paragraphs: [
    "A large firm decides things in a room. Partners argue, check each other’s numbers and leave with a plan. On your own, the room is your head at eleven at night.",
    'The club is that room. It is not a networking group. Nobody is selling to you.',
  ],
  who: ['The three hosts of Stick to Accounting', 'Accountants who run a practice, or mean to', 'Guests who know one subject well'],
  brings: ['A fee quote to check before it goes out', 'A client you are not sure about', 'A question you would rather not ask in public', 'A first hire', 'A plan to stress-test', 'A bad week'],
} as const;

export const inside = {
  title: 'What is inside?',
  intro: `${ProgrammeCount}, one membership. Take them in any order. Start with the one that hurts.`,
} as const;

export const week = {
  title: 'Is it just videos?',
  intro: 'No. Recordings help. People help more. Every week there are live sessions, and you can bring your own work to all of them.',
  sessions: [
    { term: 'Guest sessions', detail: 'One guest, one subject. Tax, technology, law or the business of a practice. Questions from the floor.' },
    { term: 'Live programmes', detail: 'Taught a module at a time, with members working through it together. Recorded for the weeks you miss.' },
    { term: 'Clinics', detail: 'An open floor. Bring a quote, a client or a problem. Leave with an answer or a next step.' },
  ] satisfies readonly (Term & { term: SessionKind })[],
  between: [
    { term: 'Between sessions', detail: "The members’ room, online and open all week. Ask before you decide." },
    { term: "When you’re stuck", detail: 'A short one-to-one call with a host, booked when you need it, to get you moving again.' },
  ] satisfies readonly Term[],
} as const;

export const teaching = 'Each programme is taught live, a module at a time, and recorded. Bring your own clients and figures. Each module is built to end with something done, not just something learned.';

export interface RateField {
  readonly name: keyof RateInputs;
  readonly label: string;
  readonly unit?: 'RM' | '%';
  readonly hint?: string;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  /** A starting figure for the visitor to replace, not a claim about the market. */
  readonly start: number;
}

export const rate = {
  title: 'What is your lowest fair rate?',
  intro: 'Most accountants price from the market down. Start from your own costs up. Change any number. Nothing leaves this page.',
  hoursPerClient: 4,
  fields: [
    { name: 'income', label: 'Income you want this year', unit: 'RM', min: 0, step: 1000, start: 120_000 },
    { name: 'costs', label: 'Running costs this year', unit: 'RM', min: 0, step: 1000, start: 30_000, hint: 'Rent, software, insurance, subscriptions, help.' },
    { name: 'hoursPerWeek', label: 'Hours you work a week', min: 1, max: 100, start: 40 },
    { name: 'weeksOff', label: 'Weeks off a year', min: 0, max: 51, start: 6, hint: 'Leave, public holidays and sick days.' },
    { name: 'unpaidShare', label: 'Share of your time nobody pays for', unit: '%', min: 0, max: 95, start: 40, hint: 'Admin, sales, chasing and learning.' },
  ] satisfies readonly RateField[],
} as const;

export const podcast = {
  lead: 'News. Analysis. Interviews. Hosted by Hazli Johar, Abu Musa and Shukri Yusof.',
  find: 'Search for Stick to Accounting on YouTube, Spotify or Apple Podcasts.',
  /** Where every episode is published. */
  youtube: 'https://www.youtube.com/@TheRestIsAccountancy',
  /** The channel with YouTube's subscribe prompt open. */
  subscribe: 'https://www.youtube.com/@TheRestIsAccountancy?sub_confirmation=1',
  hostNames: authors.map((a) => a.name),
} as const;

export const fit = {
  title: 'Is this for you?',
  intro: 'The room works when everyone in it comes to work. Be honest with yourself here.',
  yes: ['You run a practice, or plan to within the year', "You price by the hour and suspect you shouldn’t", 'You are good at the work and unsure about the business', 'You want peers who will tell you the truth'],
  notYet: ['You want a certificate more than a better firm', 'You came to sell to accountants', 'You want answers without doing the work'],
} as const;

export const questions = {
  title: 'Questions',
  items: [
    { term: 'What is the club?', detail: `A paid membership for accountants who run a practice or are about to. ${ProgrammeCount}, live sessions every week and a members' room, in one place.` },
    { term: 'Do I need my own firm already?', detail: 'No. Foundations is written for the year before you open. Many of the hardest decisions come before the first client.' },
    { term: 'I work in industry. Is it for me?', detail: 'If you plan to go out on your own, yes. If not, the podcast will serve you better than the club.' },
    { term: 'How much time does it take?', detail: 'As much as you give it. The live sessions are recorded. An hour a week, used well, is enough to change how you price.' },
    { term: 'What does it cost?', detail: 'We send the rate with your invitation, before you commit to anything.' },
    { term: 'Why by request?', detail: 'Because the room only works if everyone in it is there to work. We read every request and reply by email.' },
    { term: 'Is the podcast the same thing?', detail: 'No. Stick to Accounting is free and public. The club is where members do the work the episodes talk about.' },
  ] satisfies readonly Term[],
} as const;

export const joining = {
  title: 'How does joining work?',
  steps: [
    { term: 'Request', detail: 'Tell us your name, your work email and where your practice stands.' },
    { term: 'Reply', detail: 'We read every request and reply by email, with the rate.' },
    { term: 'Invitation', detail: `Your invitation holds a private link. It works once and lasts ${LINK_DAYS.welcome} days.` },
    { term: 'Start', detail: 'Set a password, pay the first month online, and open the programme that hurts most.' },
  ] satisfies readonly Term[],
} as const;

export const joinSection = {
  label: 'Join',
  title: "The syllabus ended. The work didn’t.",
  lead: 'Tell us who you are and where your practice stands. We reply to every request by email.',
  stages: ['I run a practice', "I’m about to open one", 'I work in a firm', 'I work in industry'],
  card: { role: 'Member', namePlaceholder: 'Your name', number: 'Pending' },
  messages: {
    name: 'Enter your name.',
    email: 'Enter an email like name@firm.com.my.',
    sending: 'Sending.',
    failed: 'That did not send. Try again in a minute.',
    sent: (email: string) => `Received. We will write to ${email}.`,
  },
} as const;
