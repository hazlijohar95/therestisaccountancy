/** Random choices on the server. crypto.getRandomValues is available in Workers and in Node. */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A random string from an alphabet with no lookalike characters (no I, O, 0 or 1). 10 characters are 50 bits. */
export function unguessable(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** An unbiased random order of 0..n-1. */
export function randomPermutation(n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** FNV-1a: a small stable hash, for seeding. Not for secrets. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A fixed order of 0..n-1 for a seed. Review questions use one per listener and question, so options come in an order
 * of the server's choosing that stays put across reloads, and the server can map a pick back without storing anything.
 */
export function seededPermutation(n: number, seed: string): number[] {
  let state = hash(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
