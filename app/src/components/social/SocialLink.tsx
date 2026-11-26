import { createLink, useRouter } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, Ref } from 'react';
import { socialHref } from '../../lib/links.ts';

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & { current?: boolean | 'step' | 'true'; ref?: Ref<HTMLAnchorElement> };

/*
 * A link within Social, marked current only where the page says so: current is the page, or a step or item in a set.
 * TanStack's Link marks itself current, with an "active" class, whenever its path and search are part of the page's:
 * every link to the Floor on a thread, and "All" beside the filter picked.
 */
function Anchor({ current = false, className, ...props }: AnchorProps) {
  const classes = className?.split(' ').filter((name) => name !== 'active').join(' ') || undefined;
  return <a {...props} className={classes} data-status={undefined} aria-current={current === true ? 'page' : current || undefined} />;
}

export const SocialLink = createLink(Anchor);

/** Goes to a Social page inside the app, without a reload. The path is as Social's own links write it: /verify?step=body. */
export function useGo() {
  const router = useRouter();
  return (path: string) => {
    const href = socialHref(path);
    if (href.startsWith('/')) router.history.push(href);
    else window.location.assign(href);
  };
}
