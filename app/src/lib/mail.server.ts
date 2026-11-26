import { env, waitUntil } from 'cloudflare:workers';
import type { Letter } from '../../../src/server/letters.ts';
import { send } from '../../../src/server/mail.ts';

/** Sends after the response, so nobody waits on the mail. Gather what the letters need before calling. */
export function sendLater(letters: readonly Letter[]): void {
  if (letters.length) waitUntil(Promise.all(letters.map(send)));
}

/** A full address on the configured site, for links that leave in an email. Never built on the request's Host. */
export const absolute = (path: string) => new URL(path, env.SITE_URL).href;
