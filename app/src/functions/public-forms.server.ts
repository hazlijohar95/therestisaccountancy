import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { joinSection } from '../../../src/data/club.ts';
import { joinRequestLetter, newsletterConfirmLetter } from '../../../src/server/letters.ts';
import { email, oneLine } from '../lib/fields.ts';
import { tooManyTries, type LimitedForm } from '../lib/action.ts';
import { allowed } from '../lib/limits.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { parsed } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * The plain HTML forms on the static marketing pages: the newsletter sign-up and the membership request. Each posts
 * here and gets a 303 to a page that shows what happened. A script that asks for JSON gets the outcome as JSON instead.
 * The result rides in a short-lived cookie rather than the URL, so the email never lands in a log or the history.
 */

/** What a form post answers: the email it was for, or the refusal with each field's first problem. */
const formResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), email: z.string() }),
  z.object({ ok: z.literal(false), message: z.string(), fields: z.record(z.string(), z.string()), posted: z.record(z.string(), z.string()) }),
]);
type FormResult = z.infer<typeof formResult>;

type Answer = { readonly ok: true; readonly email: string } | { readonly ok: false; readonly status: 400 | 429; readonly message: string; readonly fields: Readonly<Record<string, string>> };

interface PlainForm {
  /** The cookie the result rides in, and the page that reads it. */
  readonly cookie: string;
  readonly page: string;
  /** Fields shown back to the person on a refusal, so they need not type them again. Never the honeypot. */
  readonly keep: readonly string[];
  readonly run: (fields: Readonly<Record<string, string>>) => Promise<Answer>;
}

const RESULT_SECONDS = 300;
const KEPT_LENGTH = 200;

const wantsJson = (request: Request) => (request.headers.get('accept') ?? '').includes('application/json');

/** Answers a post from a plain form: JSON for a script that asks for it, a 303 to the result page otherwise. */
async function answer(request: Request, form: PlainForm): Promise<Response> {
  const body = await request.formData().catch(() => new FormData());
  const fields: Record<string, string> = {};
  for (const [name, value] of body) if (typeof value === 'string' && !(name in fields)) fields[name] = value;
  const outcome = await form.run(fields);
  if (wantsJson(request)) {
    return outcome.ok ? Response.json({ ok: true, email: outcome.email }) : Response.json({ ok: false, message: outcome.message, fields: outcome.fields }, { status: outcome.status });
  }
  const posted = Object.fromEntries(form.keep.flatMap((name) => (fields[name] === undefined ? [] : [[name, fields[name].slice(0, KEPT_LENGTH)]])));
  const result: FormResult = outcome.ok ? { ok: true, email: outcome.email } : { ok: false, message: outcome.message, fields: { ...outcome.fields }, posted };
  setCookie(form.cookie, JSON.stringify(result), { path: '/', httpOnly: true, sameSite: 'lax', secure: new URL(request.url).protocol === 'https:', maxAge: RESULT_SECONDS });
  return new Response(null, { status: 303, headers: { Location: form.page } });
}

/** Validates, then throttles, as the Astro actions did: a post with a typo does not count against the address. */
async function checked<S extends z.ZodType>(schema: S, input: unknown, limit: LimitedForm, run: (value: z.output<S>) => Promise<string>): Promise<Answer> {
  const parsedInput = await parsed(schema, input);
  if (!parsedInput.ok) return { ok: false, status: 400, message: parsedInput.message, fields: parsedInput.fields };
  if (!(await allowed(limit))) return { ok: false, status: 429, message: tooManyTries, fields: {} };
  return { ok: true, email: await run(parsedInput.value) };
}

/** The result a form's page shows, read once. Null when there is none, or it has run out. */
export function takeResult(cookie: string): FormResult | null {
  const raw = getCookie(cookie);
  if (raw === undefined) return null;
  deleteCookie(cookie, { path: '/' });
  try {
    const result = formResult.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const joinRequest = z.object({
  name: z.string().transform(oneLine).pipe(z.string().min(1, joinSection.messages.name).max(60)),
  email,
  stage: z.enum(joinSection.stages),
  /** A field people never see, named so no autofill fills it. Bots that fill every field get a thank-you and nothing is saved. */
  trap: z.string().optional(),
});

export const JOIN_RESULT = 'join-result';
const JOIN_PAGE = '/join/request';

/** POST /join: a request for membership. The admins hear of each new one. */
export const join = (request: Request) =>
  answer(request, {
    cookie: JOIN_RESULT,
    page: JOIN_PAGE,
    keep: ['name', 'email', 'stage'],
    run: (fields) =>
      checked(joinRequest, { name: fields['name'] ?? '', email: fields['email'] ?? '', stage: fields['stage'] ?? '', trap: fields['trap'] }, 'join', async ({ trap, ...person }) => {
        if (trap) return person.email;
        const admins = await withStore(async (store) => ((await store.club.recordJoinRequest(person)) ? await store.club.adminEmails() : []));
        if (admins.length) sendLater([joinRequestLetter(admins, person, absolute('/admin'))]);
        return person.email;
      }),
  });

const subscription = z.object({
  email,
  /** Where on the site the form sits. A form that sends something odd still signs the person up. */
  source: z.string().regex(/^[a-z0-9-]{1,32}$/).catch('site'),
  /** A field people never see. Bots that fill every field get the same answer and no letter goes. */
  trap: z.string().optional(),
});

export const NEWSLETTER_RESULT = 'newsletter-result';
const NEWSLETTER_PAGE = '/newsletter/subscribe';

/** POST /newsletter/subscribe: double opt-in. Answers the same whoever is or is not on the list. */
export const subscribe = (request: Request) =>
  answer(request, {
    cookie: NEWSLETTER_RESULT,
    page: NEWSLETTER_PAGE,
    keep: ['email'],
    run: (fields) =>
      checked(subscription, { email: fields['email'] ?? '', source: fields['source'], trap: fields['trap'] }, 'newsletter', async ({ email: address, source, trap }) => {
        const link = trap ? null : await withStore(async (store) => await store.newsletter.subscribe(address, source));
        if (link) {
          const confirmUrl = absolute(`/newsletter/confirm?token=${encodeURIComponent(link.token)}`);
          sendLater([newsletterConfirmLetter({ email: link.email, link: confirmUrl, expiresAt: link.expiresAt })]);
        }
        return address;
      }),
  });
