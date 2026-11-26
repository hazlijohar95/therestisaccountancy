import { useMatches, useRouterState } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import type { Track } from '../../../../src/data/social.ts';
import { SEARCH_MAX } from '../../../../src/lib/search.ts';
import { initCommands } from '../../../../src/lib/commands.ts';
import { initSearch } from '../../../../src/lib/search-dialog.ts';
import { clubHref, socialHref, socialSignInHref } from '../../lib/links.ts';
import { Logo } from '../club/Logo.tsx';
import { Avatar } from './Avatar.tsx';
import { Symbols } from './Symbols.tsx';

/** The nav item a Social page belongs to, set as a route's staticData. */
export type Section = 'floor' | 'list' | 'problems' | 'verify' | 'notifications';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    section?: Section;
  }
}

export interface Chrome {
  readonly member: { readonly name: string } | null;
  readonly profile: { readonly handle: string; readonly track: Track; readonly sealed: boolean } | null;
  readonly unread: number;
}

const NAV: readonly { section: Section; path: string; label: string; icon: string }[] = [
  { section: 'floor', path: '/', label: 'Floor', icon: 'i-floor' },
  { section: 'list', path: '/list', label: 'The List', icon: 'i-list' },
  { section: 'problems', path: '/problems', label: 'Problems', icon: 'i-problem' },
  { section: 'verify', path: '/verify', label: 'Get ticked', icon: 'tk' },
];

/** Social's header, footer and search dialog around a page. */
export function SocialLayout({ chrome, children }: { chrome: Chrome; children: ReactNode }) {
  const section = useMatches({ select: (matches) => matches.findLast((match) => match.staticData.section)?.staticData.section });
  /* The path as the visitor sees it, so signing in comes back here. */
  const here = useRouterState({ select: (state) => `${state.location.pathname.replace(/^\/social(?=\/|$)/, '') || '/'}${state.location.searchStr}` });
  const { member, profile, unread } = chrome;

  useEffect(() => {
    initCommands();
    initSearch();
  }, []);

  return (
    <>
      <Symbols />
      <header className="top">
        <div className="top-in">
          <a className="brand" href={socialHref('/')} aria-label="The Rest Is Accountancy Social, home">
            <Logo brand="club" className="wordmark" />
            <span className="tape">social</span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <a key={item.section} href={socialHref(item.path)} aria-current={item.section === section ? 'page' : undefined}>
                <svg aria-hidden="true">
                  <use href={`#${item.icon}`} />
                </svg>
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <div className="top-end">
            <a className="icon-btn" href={socialHref('/search')} aria-label="Search" aria-keyshortcuts="Control+K Meta+K /" data-search-open>
              <svg aria-hidden="true">
                <use href="#i-search" />
              </svg>
            </a>
            {member ? (
              <>
                <a
                  className="icon-btn bell"
                  href={socialHref('/notifications')}
                  aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
                  aria-current={section === 'notifications' ? 'page' : undefined}
                >
                  <svg aria-hidden="true">
                    <use href="#i-bell" />
                  </svg>
                  {unread > 0 && (
                    <span className="count" aria-hidden="true">
                      {unread}
                    </span>
                  )}
                </a>
                <a className="me" href={socialHref('/me')} aria-label="Your profile">
                  <Avatar name={member.name} track={profile?.track} sealed={profile?.sealed ?? false} size="sm" />
                </a>
              </>
            ) : (
              <>
                <a className="btn sm ghost" href={socialSignInHref(here)}>
                  Sign in
                </a>
                <a className="btn sm" href={socialHref('/request')}>
                  Request to join
                </a>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="foot">
        <p>Ticks confirm credentials. They never vouch for advice.</p>
        <nav aria-label="Footer">
          <a href={socialHref('/ticks')}>What a tick means</a>
          <a href={socialHref('/nominate')}>Nominate someone</a>
          {member ? <a href={socialHref('/invites')}>Invite someone</a> : <a href={socialHref('/request')}>Request to join</a>}
          <a href={clubHref('/')}>The club</a>
          <a href={clubHref('/privacy')}>Privacy</a>
        </nav>
      </footer>
      {/* The dialog fetches from the host the page is on: the social host would be another origin from /social on the club's. */}
      <dialog className="modal card search" id="search" aria-labelledby="search-title" data-endpoint={socialHref('/search')} data-nominate={socialHref('/nominate')}>
        <h2 className="sr-only" id="search-title">
          Search
        </h2>
        <div className="s-box">
          <svg className="ic" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            id="s-q"
            className="s-input"
            type="search"
            role="combobox"
            aria-expanded="false"
            aria-controls="s-list"
            aria-autocomplete="list"
            aria-label="Search people and posts"
            placeholder="Search people and posts"
            autoComplete="off"
            spellCheck={false}
            maxLength={SEARCH_MAX}
          />
        </div>
        <div id="s-list" role="listbox" aria-label="Results" />
        <p className="s-hint" id="s-hint">
          Type a name, a handle, a topic or words from a post.
        </p>
        <p className="sr-only" role="status" id="s-count" />
        <p className="s-keys small" aria-hidden="true">
          <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close
        </p>
        <button className="icon-btn close" type="button" aria-label="Close search" data-search-close>
          <svg aria-hidden="true">
            <use href="#i-x" />
          </svg>
        </button>
      </dialog>
    </>
  );
}
