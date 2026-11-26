import type { ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { Bar } from './Bar.tsx';
import { Footer } from './Footer.tsx';

/** A club page: the bar, the page, the footer. */
export function Page({ children, signup = true }: { children: ReactNode; signup?: boolean }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      <Bar pathname={pathname} />
      <main id="main">{children}</main>
      <Footer signup={signup} />
    </>
  );
}
