import { createHash } from 'node:crypto';
import { count, type Db } from './db.ts';

export const POSTS_PER_MINUTE = 5;
const WINDOW_MS = 60_000;

/** The posts a public form took from one source in the last minute. Keys are hashed, and rows older than a minute are dropped on every check. */
export function createLimits(db: Db, now: () => Date = () => new Date()) {
  return {
    /** True, and counted, when the source has posts left this minute. A refused post is not counted, so a flood costs reads, not writes. */
    allow(key: string): boolean {
      return db.transaction(() => {
        const at = now().getTime();
        const hashed = createHash('sha256').update(key).digest('hex');
        db.prepare('DELETE FROM form_posts WHERE at <= ?').run(at - WINDOW_MS);
        if (count(db.prepare('SELECT count(*) AS n FROM form_posts WHERE key = ?').get(hashed)) >= POSTS_PER_MINUTE) return false;
        db.prepare('INSERT INTO form_posts (key, at) VALUES (?, ?)').run(hashed, at);
        return true;
      });
    },
  };
}

/** One source per IPv4 address, or per IPv6 /64, the block one connection is usually given. */
export function sourceOf(address: string): string {
  if (!address.includes(':')) return address;
  const [head = '', tail = ''] = address.toLowerCase().split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...front, ...Array<string>(8 - front.length - back.length).fill('0'), ...back] : front;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
