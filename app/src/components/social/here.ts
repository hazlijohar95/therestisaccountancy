import { useRouterState } from '@tanstack/react-router';
import { socialSignInHref } from '../../lib/links.ts';

/** The Social page being shown, as the visitor sees it: /social/edit is /edit. */
export const useSocialPath = () => useRouterState({ select: (state) => state.location.pathname.replace(/^\/social(?=\/|$)/, '') || '/' });

/** Sign in, then come back to this page. */
export const useSignInHref = () => socialSignInHref(useSocialPath());
