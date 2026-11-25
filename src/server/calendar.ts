import { site } from '../data/site.ts';
import type { LiveSession } from './schedule.ts';

const stamp = (value: string | Date) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545 text: backslash, semicolon and comma escaped, line breaks as \n. */
const escape = (value: string) => value.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
/** Lines longer than 75 octets continue on the next line after a space. */
const fold = (line: string) => {
  const parts: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return [...parts, rest].join('\r\n ');
};

/** A calendar file for one session. The same UID every time, so a second import updates the first. */
export function calendarFile(session: LiveSession, host: string, cancelled = false): string {
  const end = new Date(new Date(session.startsAt).getTime() + session.minutes * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escape(site.name)}//Sessions//EN`,
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:session-${session.id}@${host}`,
    `SEQUENCE:${cancelled ? 1 : 0}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(session.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(session.title)}`,
    `DESCRIPTION:${escape([session.detail, session.link].filter(Boolean).join('\n\n'))}`,
    `LOCATION:${escape(session.link)}`,
    `URL:${escape(session.link)}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
