import { createLink } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, Ref } from 'react';

type ChipProps = AnchorHTMLAttributes<HTMLAnchorElement> & { current: boolean; ref?: Ref<HTMLAnchorElement> };

/*
 * A link in a group of filters or sorts, marked current by the page's own rule. A plain Link marks itself current
 * whenever its search is part of the page's, so "All" and "Top" would read as current beside the one picked.
 */
function Chip({ current, ...props }: ChipProps) {
  return <a {...props} data-status={undefined} aria-current={current ? 'page' : undefined} />;
}

export const ChipLink = createLink(Chip);
