const day = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });

const moment = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

/** 24 Nov 2026, 3:04 pm, in Malaysian time. */
export const formatMoment = (value: string) => moment.format(new Date(value));

/** 24 Nov 2026, in Malaysian time. */
export const formatDay = (value: string | Date) => day.format(typeof value === 'string' ? new Date(value) : value);

const month = new Intl.DateTimeFormat('en-MY', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Nov 2026, for a month stored as 2026-11. */
export const formatMonth = (value: string) => month.format(new Date(`${value}-01T00:00:00Z`));

const time = new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

/** 3:04 pm, in Malaysian time. */
export const formatTime = (value: string) => time.format(new Date(value));

const weekday = new Intl.DateTimeFormat('en-MY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kuala_Lumpur' });

/** Tuesday, 24 November, in Malaysian time. */
export const formatWeekday = (value: string) => weekday.format(new Date(value));

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** "seven" for 7: copy spells out small counts. Past twelve it uses digits. */
export const numberWord = (n: number) => WORDS[n] ?? String(n);

export const capitalised = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

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

const counted = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });

/** "1 template", "15 templates": a count with its noun, singular or plural. */
export const tally = (count: number, one: string, many = `${one}s`) => `${counted.format(count)} ${count === 1 ? one : many}`;
