import type { Published } from "./catalogue.ts";

/**
 * Published versions, kept in this isolate. A published version never changes (catalogue.ts), so a copy is never stale
 * and needs no expiry: every heard report, review answer and sitting reads its course from here, and only a version
 * this isolate has not seen yet costs a call to the one catalogue object. Only hits are kept: a version not yet
 * published must be found once it is. The oldest-used version goes first once `max` are held.
 */
export function publishedCache(load: (courseId: string, version: number) => Promise<Published | null>, max = 200) {
  const held = new Map<string, Published>();
  const key = (courseId: string, version: number) => `${courseId}@${version}`;

  const remember = (p: Published): void => {
    const k = key(p.courseId, p.version);
    held.delete(k);
    held.set(k, p);
    if (held.size > max) {
      const oldest = held.keys().next().value;
      if (oldest !== undefined) held.delete(oldest);
    }
  };

  return {
    async get(courseId: string, version: number): Promise<Published | null> {
      const hit = held.get(key(courseId, version));
      if (hit) {
        remember(hit);
        return hit;
      }
      const p = await load(courseId, version);
      if (p) remember(p);
      return p;
    },
    /** Keeps versions read some other way, such as the catalogue's newest-of-each listing. */
    remember,
    get size() {
      return held.size;
    },
  };
}
