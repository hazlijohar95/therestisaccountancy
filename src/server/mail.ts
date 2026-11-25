import { env } from 'cloudflare:workers';
import { site } from '../data/site.ts';
import { renderLetter } from '../emails/render.tsx';
import type { Letter } from './letters.ts';

/** Sends the letter from the club's address. False if it did not go; the caller decides what the person sees. */
export async function send(letter: Letter): Promise<boolean> {
  try {
    const { html, text } = await renderLetter(letter);
    await env.EMAIL.send({
      from: { name: site.name, email: env.MAIL_FROM },
      to: typeof letter.to === 'string' ? letter.to : [...letter.to],
      subject: letter.subject,
      text,
      html,
      ...(letter.unsubscribe && { headers: { 'List-Unsubscribe': `<${letter.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
      ...(letter.attachments && { attachments: letter.attachments.map((a) => ({ disposition: 'attachment' as const, ...a })) }),
    });
    return true;
  } catch (error) {
    console.error('Email did not send', letter.subject, error);
    return false;
  }
}
