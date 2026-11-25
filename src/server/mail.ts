import { env } from 'cloudflare:workers';
import { site } from '../data/club.ts';
import { formatDay } from '../lib/format.ts';
import type { JoinRequest, LinkPurpose } from './club.ts';

/** One email, written once as plain text. The HTML part is the same text, escaped, with links made clickable. */
export interface Letter {
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly lines: readonly string[];
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const linkify = (escaped: string) => escaped.replace(/https?:\/\/\S+/g, (url) => `<a href="${url}">${url}</a>`);

/** Sends the letter from the club's address. False if it did not go; the caller decides what the person sees. */
export async function send(letter: Letter): Promise<boolean> {
  try {
    await env.EMAIL.send({
      from: { name: site.name, email: env.MAIL_FROM },
      to: typeof letter.to === 'string' ? letter.to : [...letter.to],
      subject: letter.subject,
      text: letter.lines.join('\n\n'),
      html: letter.lines.map((line) => `<p>${linkify(escape(line))}</p>`).join('\n'),
    });
    return true;
  } catch (error) {
    console.error('Email did not send', letter.subject, error);
    return false;
  }
}

/** A password link: an invitation for someone without a password, a reset for a member who has one. */
export function passwordLetter(link: { email: string; name: string; purpose: LinkPurpose; link: string; expiresAt: string }): Letter {
  const until = formatDay(link.expiresAt);
  const body = {
    welcome: {
      subject: `Your invitation to ${site.name}`,
      lines: [
        `Your membership of ${site.name} is ready. Set your password with this link. It works once, until ${until}.`,
        link.link,
        'Then sign in and open the programme that matters most to you this month.',
      ],
    },
    reset: {
      subject: `Reset your ${site.name} password`,
      lines: [
        `Someone asked to reset the password for your membership. Choose a new one with this link. It works once, until ${until}, and signs you out everywhere else.`,
        link.link,
        'If it was not you, ignore this email. Your password stays as it is.',
      ],
    },
  } as const satisfies Record<LinkPurpose, { subject: string; lines: readonly string[] }>;
  const { subject, lines } = body[link.purpose];
  return { to: link.email, subject, lines: [`Hello ${link.name},`, ...lines, site.name] };
}

/** Tells the admins a request has come in. Only ever sent to them, never to the address typed into the form. */
export function joinRequestLetter(admins: readonly string[], request: Pick<JoinRequest, 'name' | 'email' | 'stage'>, adminUrl: string): Letter {
  return {
    to: admins,
    subject: `Membership request from ${request.name}`,
    lines: [`${request.name} (${request.email}) asked to join. Where they are: ${request.stage}.`, `Read it and decide: ${adminUrl}`],
  };
}
