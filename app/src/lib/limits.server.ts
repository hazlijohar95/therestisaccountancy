import { getRequestHeader } from '@tanstack/react-start/server';
import { sourceOf } from '../../../src/server/limits.ts';
import type { LimitedForm } from './action.ts';
import { withStore } from './store.server.ts';

/** The key a form's posts are counted under: the form and the address they come from. */
export const clientKey = (form: LimitedForm) => `${form} ${sourceOf(getRequestHeader('cf-connecting-ip') ?? 'unknown')}`;

/** True when the form may take another post from this address. */
export const allowed = (form: LimitedForm) => withStore((store) => store.limits.allow(clientKey(form)));
