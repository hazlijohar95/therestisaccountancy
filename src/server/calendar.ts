import { site } from '../data/site.ts';
import type { LiveSession } from './schedule.ts';

/** One event in a calendar file: a live session or a one-to-one call. */
export interface CalendarEvent {
  /** The same for every file about this event, so a second import updates the first. */
  readonly uid: string;
  readonly title: string;
  readonly startsAt: string;
  readonly minutes: number;
  readonly description: string;
  readonly link: string;
}

const stamp = (value: string | Date) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545 text: backslash, semicolon and comma escaped, line breaks as \n. */
const escape = (value: string) => value.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
/** Lines longer than 75 octets continue on the next line after a space, never splitting a character. */
const fold = (line: string) => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const parts: string[] = [];
  let part = '';
  for (const char of line) {
    if (bytes(part + char) > (parts.length ? 74 : 75)) {
      parts.push(part);
      part = '';
    }
    part += char;
  }
  return [...parts, part].join('\r\n ');
};

/** A live session as a calendar event, under the UID it has always had. */
export const sessionEvent = (session: LiveSession, host: string): CalendarEvent => ({
  uid: `session-${session.id}@${host}`,
  title: session.title,
  startsAt: session.startsAt,
  minutes: session.minutes,
  description: session.detail,
  link: session.link,
});

/** A calendar file for one event, or for taking it out of the calendar again. */
export function calendarFile(event: CalendarEvent, cancelled = false): string {
  const end = new Date(new Date(event.startsAt).getTime() + event.minutes * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escape(site.name)}//Calendar//EN`,
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SEQUENCE:${cancelled ? 1 : 0}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape([event.description, event.link].filter(Boolean).join('\n\n'))}`,
    `LOCATION:${escape(event.link)}`,
    `URL:${escape(event.link)}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
