import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarFile, sessionEvent } from './calendar.ts';

const session = { id: 7, title: 'Pricing, fees; and more', kind: 'Clinics' as const, startsAt: '2026-11-26T12:00:00Z', minutes: 90, link: 'https://meet.example/abc', detail: 'Bring a quote.\nAny quote.', going: 0, attending: false };

test('a session becomes a calendar event with its times, escaped text and a stable id', () => {
  const ics = calendarFile(sessionEvent(session, 'better-accountant.com'));
  assert.match(ics, /\r\nDTSTART:20261126T120000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20261126T133000Z\r\n/);
  assert.ok(ics.includes('\r\nSUMMARY:Pricing\\, fees\\; and more\r\n'));
  assert.match(ics, /\r\nUID:session-7@better-accountant.com\r\n/);
  assert.ok(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75), 'long lines are folded');
  assert.match(calendarFile(sessionEvent(session, 'better-accountant.com'), true), /METHOD:CANCEL[\s\S]*STATUS:CANCELLED/);
});

test('folding long lines never splits a character', () => {
  const ics = calendarFile(sessionEvent({ ...session, title: `${'Pricing clinic '.repeat(4)}🎙️🎙️🎙️🎙️🎙️` }, 'better-accountant.com'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('🎙️🎙️🎙️🎙️🎙️'));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(ics), 'no lone surrogate');
});
