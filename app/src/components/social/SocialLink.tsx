import { useRouter } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { socialHref } from '../../lib/links.ts';

/** Goes to a Social page inside the app, without a reload. The path is as Social's own links write it: /verify?step=body. */
export function useGo() {
  const router = useRouter();
  return (path: string) => {
    const href = socialHref(path);
    if (href.startsWith('/')) router.history.push(href);
    else window.location.assign(href);
  };
}

/**
 * A link to a Social page that the app follows without a reload. Unlike the router's Link it adds no aria-current or
 * class of its own, so a step or a tab keeps the markup the stylesheet reads.
 */
export function SocialLink({ path, ...props }: { path: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const go = useGo();
  const href = socialHref(path);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target || !href.startsWith('/')) return;
    event.preventDefault();
    go(path);
  };
  return <a {...props} href={href} onClick={follow} />;
}
