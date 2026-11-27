import type { Waiting } from '../lib/waiting.ts';
import type { Modules } from './store.ts';

const DAY_MS = 86_400_000;

/** A queue whose oldest item has waited longer than this is stale: the admin page marks it, and the morning summary names it. */
export const STALE_MS = 2 * DAY_MS;

/** The page that clears a queue: a path on the club's site, or a Social path, which each page turns into a link from where it is. */
export interface Where {
  readonly site: 'club' | 'social';
  readonly path: string;
}

interface Queue {
  readonly id: string;
  /** What waits, in plain words: "Club join requests", "Documents to check". */
  readonly label: string;
  readonly where: Where;
  /** The owning module's own count of what waits, so this can never disagree with the page that clears it. */
  readonly read: (store: Modules) => Waiting;
}

const review = (tab: string): Where => ({ site: 'social', path: `/review?tab=${tab}` });

/** Every queue that waits on the hosts, in the order the admin page lists them. */
const QUEUES: readonly Queue[] = [
  { id: 'club-requests', label: 'Club join requests', where: { site: 'club', path: '/admin#pending-title' }, read: (s) => s.club.waiting() },
  { id: 'listings', label: 'Directory listings to check', where: { site: 'club', path: '/admin/listings' }, read: (s) => s.listings.waiting() },
  { id: 'plans', label: 'Plans to answer', where: { site: 'club', path: '/admin/plans' }, read: (s) => s.plans.waiting() },
  { id: 'accounts', label: 'Accounts to prove', where: review('accounts'), read: (s) => s.socialClaims.waiting().accounts },
  { id: 'credentials', label: 'Credentials to check', where: review('credentials'), read: (s) => s.socialClaims.waiting().credentials },
  { id: 'documents', label: 'Documents to check', where: review('documents'), read: (s) => s.socialClaims.waiting().documents },
  { id: 'nominations', label: 'Nominations to decide', where: review('nominations'), read: (s) => s.socialNominations.waiting() },
  { id: 'reports', label: 'Reports to decide', where: review('reports'), read: (s) => s.socialFloor.waiting() },
  { id: 'social-requests', label: 'Social join requests', where: review('requests'), read: (s) => s.socialRequests.waiting() },
];

export interface HostQueue extends Omit<Queue, 'read'>, Waiting {
  /** Whole days the oldest item has waited. Zero when nothing waits. */
  readonly ageDays: number;
  readonly stale: boolean;
}

/** Every queue with how many items wait, since when, and whether the oldest has waited longer than STALE_MS. */
export function hostQueues(store: Modules, now: Date): HostQueue[] {
  return QUEUES.map(({ read, ...queue }) => {
    const { count, since } = read(store);
    const age = since === null ? 0 : now.getTime() - Date.parse(since);
    return { ...queue, count, since, ageDays: Math.floor(age / DAY_MS), stale: age > STALE_MS };
  });
}

/** The hosts' queues, read inside the store so the page and the hourly job each make one call. */
export function createQueues(store: Modules, now: () => Date) {
  return {
    host: (): HostQueue[] => hostQueues(store, now()),

    /**
     * For the morning summary: one incident naming every stale queue, at most once a day. One incident rather than one
     * per queue, because recordOnce keeps one of a kind a day. Kept short to fit an incident even with every queue stale.
     * The detail when it recorded one, else null.
     */
    nudge(): string | null {
      const stale = hostQueues(store, now()).filter((q) => q.stale);
      if (!stale.length) return null;
      const detail = `Waiting more than ${STALE_MS / DAY_MS} days. ${stale.map((q) => `${q.label}: ${q.count}, oldest ${q.ageDays} days`).join('; ')}.`;
      return store.incidents.recordOnce('queue', detail) ? detail : null;
    },
  };
}
