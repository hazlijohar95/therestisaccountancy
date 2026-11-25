import { site } from '../data/site.ts';
import { formatDay } from '../lib/format.ts';
import type { JoinRequest, LinkPurpose } from './club.ts';

/** A paragraph of text, or a link the club built. Only built links become clickable: typed input never does. */
export type Line = string | { readonly href: string };

/** One email, written once. The text part and the HTML part come from the same lines. */
export interface Letter {
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly lines: readonly Line[];
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const asText = (line: Line) => (typeof line === 'string' ? line : line.href);
export const asHtml = (line: Line) => (typeof line === 'string' ? `<p>${escape(line)}</p>` : `<p><a href="${escape(line.href)}">${escape(line.href)}</a></p>`);

/** A password link: an invitation for someone without a password, a reset for a member who has one. */
export function passwordLetter(link: { email: string; name: string; purpose: LinkPurpose; link: string; expiresAt: string }): Letter {
  const until = formatDay(link.expiresAt);
  const body = {
    welcome: {
      subject: `Your invitation to ${site.name}`,
      lines: [
        `Your membership of ${site.name} is ready. Set your password with this link. It works once, until ${until}.`,
        { href: link.link },
        'Then sign in and open the programme that matters most to you this month.',
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
