import { site } from '../data/site.ts';
import { formatDay, formatMoment } from '../lib/format.ts';
import type { JoinRequest, LinkPurpose } from './club.ts';
import { calendarFile } from './calendar.ts';
import type { Recipient } from './mailings.ts';
import type { LiveSession } from './schedule.ts';

/** A paragraph of text, or a link the club built. Only built links become clickable: typed input never does. */
export type Line = string | { readonly href: string };

/** One email, written once. The text part and the HTML part come from the same lines. */
export interface Letter {
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly lines: readonly Line[];
  readonly attachments?: readonly { readonly filename: string; readonly type: string; readonly content: string }[];
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const asText = (line: Line) => (typeof line === 'string' ? line : line.href);
export const asHtml = (line: Line) => (typeof line === 'string' ? `<p>${escape(line)}</p>` : `<p><a href="${escape(line.href)}">${escape(line.href)}</a></p>`);

/** A password link: an invitation for someone without a password, a reset for a member who has one. */
export function passwordLetter(link: { email: string; name: string; purpose: LinkPurpose; link: string; expiresAt: string; rate: string | null }): Letter {
  const until = formatDay(link.expiresAt);
  const body = {
    welcome: {
      subject: `Your invitation to ${site.name}`,
      lines: [
        `Your membership of ${site.name} is ready. Set your password with this link. It works once, until ${until}.`,
        { href: link.link },
        link.rate
          ? `Membership is ${link.rate}. Once your password is set, you pay the first month by card, and you are in.`
          : 'Then sign in and open the programme that matters most to you this month.',
      ],
    },
    reset: {
      subject: `Reset your ${site.name} password`,
      lines: [
        `Someone asked to reset the password for your membership. Choose a new one with this link. It works once, until ${until}, and signs you out everywhere else.`,
        { href: link.link },
        'If it was not you, ignore this email. Your password stays as it is.',
      ],
    },
  } as const satisfies Record<LinkPurpose, { subject: string; lines: readonly Line[] }>;
  const { subject, lines } = body[link.purpose];
  return { to: link.email, subject, lines: [`Hello ${link.name},`, ...lines, site.name] };
}

/** Tells the admins a request has come in. Only ever sent to them, never to the address typed into the form. */
export function joinRequestLetter(admins: readonly string[], request: Pick<JoinRequest, 'name' | 'email' | 'stage'>, adminUrl: string): Letter {
  return {
    to: admins,
    subject: `Membership request from ${request.name}`,
    lines: [`${request.name} (${request.email}) asked to join. Where they are: ${request.stage}.`, 'Read it and decide:', { href: adminUrl }],
  };
}

/** Typed titles go into subjects on one line. */
const flat = (value: string) => value.replace(/\s+/g, ' ').trim();

/** The closing lines of every optional email: where to stop it. */
const optOut = (settingsUrl: string): Line[] => ['To change which emails the club sends you:', { href: settingsUrl }, site.name];

/** Tells a member someone replied in a thread they posted in. */
export function replyLetter(to: Recipient, reply: { title: string; by: string; url: string; settingsUrl: string }): Letter {
  return {
    to: to.email,
    subject: flat(`New reply: ${reply.title}`),
    lines: [`Hello ${to.name},`, `${reply.by} replied in “${reply.title}”, a thread you posted in.`, { href: reply.url }, ...optOut(reply.settingsUrl)],
  };
}

export interface DigestNews {
  readonly threads: readonly { readonly title: string; readonly channel: string; readonly replies: number; readonly url: string }[];
  readonly replies: number;
  readonly sessions: readonly { readonly title: string; readonly startsAt: string }[];
  readonly communityUrl: string;
  readonly sessionsUrl: string;
  readonly settingsUrl: string;
}

/** The week in the club. Only written when something happened or is coming up. */
export function digestLetter(to: Recipient, news: DigestNews): Letter {
  const threads: Line[] = news.threads.length
    ? [
        news.threads.length === 1 ? 'One new thread this week:' : `${news.threads.length} new threads this week:`,
        ...news.threads.flatMap((t): Line[] => [`${t.title} (${t.channel}, ${t.replies === 1 ? '1 reply' : `${t.replies} replies`})`, { href: t.url }]),
      ]
    : [];
  const replies: Line[] = news.replies ? [`${news.replies === 1 ? 'One reply' : `${news.replies} replies`} across the community this week.`, { href: news.communityUrl }] : [];
  const sessions: Line[] = news.sessions.length
    ? ['Coming up:', ...news.sessions.map((s) => `${s.title}, ${formatMoment(s.startsAt)} Malaysia time`), { href: news.sessionsUrl }]
    : [];
  return { to: to.email, subject: `This week at ${site.name}`, lines: [`Hello ${to.name},`, ...threads, ...replies, ...sessions, ...optOut(news.settingsUrl)] };
}

export type SessionNews = 'confirmed' | 'reminder' | 'cancelled';

/** About a session members said they would come to, one letter each. The confirmation and the cancellation carry a calendar file. */
export function sessionLetters(news: SessionNews, session: LiveSession, members: readonly Recipient[], siteUrl: string): Letter[] {
  const when = `${formatMoment(session.startsAt)} Malaysia time, ${session.minutes} minutes`;
  const body = {
    confirmed: { subject: `You're coming: ${session.title}`, lines: [`You're down for ${session.title}, ${when}.`, 'The calendar file attached adds it to your calendar. Join here when it starts:', { href: session.link }] },
    reminder: { subject: `Tomorrow: ${session.title}`, lines: [`${session.title} starts ${when}.`, 'Join here when it starts:', { href: session.link }] },
    cancelled: { subject: `Called off: ${session.title}`, lines: [`${session.title}, planned for ${when}, is called off. The calendar file attached removes it from your calendar.`] },
  } as const satisfies Record<SessionNews, { subject: string; lines: readonly Line[] }>;
  const { subject, lines } = body[news];
  const sessionsUrl = new URL('/members/sessions', siteUrl).href;
  const attachments = news === 'reminder' ? null : [{ filename: 'session.ics', type: 'text/calendar; charset=utf-8', content: calendarFile(session, new URL(siteUrl).hostname, news === 'cancelled') }];
  return members.map((to) => {
    const letter = { to: to.email, subject: flat(subject), lines: [`Hello ${to.name},`, ...lines, 'Every session:', { href: sessionsUrl }, site.name] };
    return attachments ? { ...letter, attachments } : letter;
  });
}

/** A monthly renewal did not go through. The member keeps access through the grace period while it is retried. */
export function renewalLetter(to: Recipient, failure: { cardRefused: boolean; accessUntil: string; payUrl: string }): Letter {
  return {
    to: to.email,
    subject: `Your ${site.name} renewal did not go through`,
    lines: [
      `Hello ${to.name},`,
      failure.cardRefused
        ? 'Your card on file can no longer be charged, so your membership did not renew.'
        : 'The charge for this month was declined. We will try the same card again tomorrow.',
      `You keep access until ${formatDay(failure.accessUntil)}. To pay now, or with another card:`,
      { href: failure.payUrl },
      site.name,
    ],
  };
}
