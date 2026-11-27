/** What one of the hosts' queues holds: how many items wait, and since when the oldest has waited, as an ISO time. */
export interface Waiting {
  readonly count: number;
  readonly since: string | null;
}

/** A queue's Waiting from the times its items started waiting, in any order. */
export function waitingOf(times: readonly string[]): Waiting {
  let since: string | null = null;
  for (const time of times) if (since === null || Date.parse(time) < Date.parse(since)) since = time;
  return { count: times.length, since };
}
