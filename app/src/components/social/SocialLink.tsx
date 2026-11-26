import { createLink } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, Ref } from 'react';

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & { current?: boolean; ref?: Ref<HTMLAnchorElement> };

/*
 * A link within Social, marked current only where the page says so. TanStack's Link marks itself current, with an
 * "active" class, whenever its path and search are part of the page's: every link to the Floor on a thread, and "All"
 * beside the filter picked.
 */
function Anchor({ current = false, className, ...props }: AnchorProps) {
  const classes = className?.split(' ').filter((name) => name !== 'active').join(' ') || undefined;
  return <a {...props} className={classes} data-status={undefined} aria-current={current ? 'page' : undefined} />;
}

export const SocialLink = createLink(Anchor);
