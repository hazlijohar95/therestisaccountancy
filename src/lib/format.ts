const day = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });

const moment = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

/** 24 Nov 2026, 3:04 pm, in Malaysian time. */
export const formatMoment = (value: string) => moment.format(new Date(value));

/** 24 Nov 2026, in Malaysian time. */
export const formatDay = (value: string | Date) => day.format(typeof value === 'string' ? new Date(value) : value);

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** "Hazli Johar, Abu Musa and Shukri Yusof" */
export const listOf = (items: readonly string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** A form action URL that keeps the page's own query string, so a POST lands back where it started. */
export const formAction = (url: URL, action: { toString(): string }) => {
  const target = new URL(url);
  for (const [key, value] of new URLSearchParams(String(action).replace(/^\?/, ''))) target.searchParams.set(key, value);
  return `${target.pathname}${target.search}`;
};
