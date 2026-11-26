import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();

const here = () => location.pathname + location.search;

export function navigate(to: string) {
  if (to === here()) return;
  history.pushState(null, "", to);
  window.scrollTo(0, 0);
  listeners.forEach((l) => l());
  // A route change is a new view: hand focus to it so keyboard and screen-reader users start there.
  requestAnimationFrame(() => document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true }));
}

/** Replaces the query string without adding a history entry. */
export function setQuery(params: Record<string, string>) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  history.replaceState(null, "", location.pathname + (q ? `?${q}` : ""));
  listeners.forEach((l) => l());
}

/** The current path including its query string. */
export function usePath(): string {
  const [path, setPath] = useState(here());
  useEffect(() => {
    const update = () => setPath(here());
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !href.startsWith("/")) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}

/** A link stretched over its positioned parent, so other controls can sit above it without nesting. */
export function Stretch({ href, label, test }: { href: string; label: string; test?: string }) {
  return <Link href={href} className="stretch" aria-label={label} data-test={test} />;
}
