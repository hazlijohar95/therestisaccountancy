import { env } from 'cloudflare:workers';
import { site } from '../data/site.ts';
import { renderLetter } from '../emails/render.tsx';
import type { Letter } from './letters.ts';
import { report } from './report.ts';

/** Sends the letter from the club's address. False if it did not go; the caller decides what the person sees. */
export async function send(letter: Letter): Promise<boolean> {
  try {
    const { html, text } = await renderLetter(letter);
    const sent = await env.EMAIL.send({
      from: { name: letter.from ?? site.name, email: env.MAIL_FROM },
      to: typeof letter.to === 'string' ? letter.to : [...letter.to],
      subject: letter.subject,
      text,
      html,
      ...(letter.unsubscribe && { headers: { 'List-Unsubscribe': `<${letter.unsubscribe.url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
      ...(letter.attachments && { attachments: letter.attachments.map((a) => ({ disposition: 'attachment' as const, ...a })) }),
    });
    /* The domain only, so the log names no person. Pairs with Cloudflare's own record of the message by its id. */
    const domains = [letter.to].flat().map((address) => address.split('@')[1] ?? '?').join(', ');
    console.log(`[email] accepted "${letter.subject}" for ${domains} as ${sent.messageId}`);
    return true;
  } catch (error) {
    await report('email', `“${letter.subject}” to ${[letter.to].flat().join(', ')} did not send`, error);
    return false;
  }
}
