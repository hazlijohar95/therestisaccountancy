import { deleteCookie, getCookie, getRequest, setCookie } from '@tanstack/react-start/server';
import { env } from 'cloudflare:workers';
import type { Member, SessionKey } from '../../../src/server/club.ts';
import { SESSION_DAYS } from '../../../src/server/sign-ins.ts';
import { withStore } from './store.server.ts';

/*
 * One sign-in for the club and Social. In production the cookie is set on the whole domain, so both hosts send it; on
 * a dev server it stays on the host, since browsers refuse a cookie for a domain the page is not on.
 */
const COOKIE = 'session';
const siteHost = new URL(env.SITE_URL).hostname;
const local = siteHost === 'localhost' || siteHost === '127.0.0.1';
const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax', secure: !local, ...(local ? {} : { domain: siteHost.replace(/^www\./, '') }) } as const;

const members = new WeakMap<Request, Promise<Member | null>>();

/** The signed-in member for this request, read once however many loaders ask. */
export function currentMember(): Promise<Member | null> {
  const request = getRequest();
  const known = members.get(request);
  if (known) return known;
  const token = getCookie(COOKIE);
  const member = token
    ? withStore(async (store) => {
        const key = await store.signIns.key(token);
        return key ? store.club.sessionMember(key) : null;
      })
    : Promise.resolve(null);
  members.set(request, member);
  return member;
}

/** Opens a session for a sign-in and sets its cookie. Any session the browser held before is ended first. */
export async function startSession(key: SessionKey): Promise<void> {
  const old = getCookie(COOKIE);
  const { token } = await withStore(async (store) => {
    if (old) await store.signIns.close(old);
    return store.signIns.open(key);
  });
  setCookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_DAYS * 86_400 });
}

/** Ends the session and clears its cookie. */
export async function endSession(): Promise<void> {
  const token = getCookie(COOKIE);
  if (token) await withStore((store) => Promise.resolve(store.signIns.close(token)));
  deleteCookie(COOKIE, cookieOptions);
}
