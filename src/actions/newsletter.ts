import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { newsletterConfirmLetter } from '../server/letters.ts';
import { absolute, email, sendLater, throttle } from './guards.ts';

export const newsletter = {
  /** Signs an address up for the free newsletter, double opt-in. Answers the same whoever is or is not on the list. */
  subscribe: defineAction({
    accept: 'form',
    input: z.object({
      email,
      /** Where on the site the form sits. A form that sends something odd still signs the person up. */
      source: z.string().regex(/^[a-z0-9-]{1,32}$/).catch('site'),
      /** A field people never see. Bots that fill every field get the same answer and no letter goes. */
      trap: z.string().optional(),
    }),
    handler: async ({ email, source, trap }, context) => {
      await throttle(context, 'newsletter');
      const link = trap ? null : await context.locals.newsletter.subscribe(email, source);
      if (link) {
        const confirmUrl = absolute(context, `/newsletter/confirm?token=${encodeURIComponent(link.token)}`);
        sendLater(context, [newsletterConfirmLetter({ email: link.email, link: confirmUrl, expiresAt: link.expiresAt })]);
      }
      return { email, message: 'Check your inbox to confirm.' };
    },
  }),
};
