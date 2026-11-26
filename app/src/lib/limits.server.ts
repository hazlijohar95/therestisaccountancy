import { getRequestHeader } from '@tanstack/react-start/server';
import { sourceOf } from '../../../src/server/limits.ts';
import { withStore } from './store.server.ts';

/** The forms that take only a few posts a minute from one address. */
export type LimitedForm = 'join' | 'sign-in' | 'link' | 'checkout' | 'survey' | 'listing' | 'call' | 'newsletter' | 'social-sign-up' | 'social-request' | 'ticks' | 'work-email' | 'nominate' | 'decline' | 'floor' | 'report' | 'answer' | 'casebook' | 'shelf';

export const tooManyTries = 'Too many tries from here. Wait a minute and try again.';

/** The key a form's posts are counted under: the form and the address they come from. */
export const clientKey = (form: LimitedForm) => `${form} ${sourceOf(getRequestHeader('cf-connecting-ip') ?? 'unknown')}`;

/** True when the form may take another post from this address. */
export const allowed = (form: LimitedForm) => withStore((store) => store.limits.allow(clientKey(form)));
