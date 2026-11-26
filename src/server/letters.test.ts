import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLetter } from '../emails/render.tsx';
import { calendarFile, sessionEvent } from './calendar.ts';
import { newsletterConfirmLetter } from './letters.ts';

const letter = (lines: Parameters<typeof renderLetter>[0]['lines'], unsubscribe?: string) => ({ to: 'aina@firm.com.my', subject: 'Hello', lines, ...(unsubscribe && { unsubscribe }) });

test('typed text is escaped and never becomes a link', async () => {
  const { html } = await renderLetter(letter(['Hello Aina,', 'Visit https://evil.example <b>now</b>']));
  assert.ok(html.includes('Visit https://evil.example &lt;b&gt;now&lt;/b&gt;'));
  assert.ok(!html.includes('href="https://evil.example'));
});

test('a link the club built is clickable in HTML and readable in text, as a button when it has a label', async () => {
  const { html, text } = await renderLetter(letter(['Hello Aina,', { href: 'https://therestisaccountancy.com/welcome?token=a&b' }, { href: 'https://therestisaccountancy.com/members/pay', label: 'Pay now' }]));
  assert.ok(html.includes('href="https://therestisaccountancy.com/welcome?token=a&amp;b"'));
  assert.ok(html.includes('>Pay now<'));
  assert.ok(text.includes('https://therestisaccountancy.com/welcome?token=a&b'));
  assert.ok(text.includes('https://therestisaccountancy.com/members/pay'));
});

test('an optional email carries its unsubscribe link in the footer', async () => {
  const { html } = await renderLetter(letter(['Hello Aina,', 'News.'], 'https://better-accountant.com/unsubscribe?t=x'));
  assert.ok(html.includes('href="https://better-accountant.com/unsubscribe?t=x"'));
  assert.ok(!(await renderLetter(letter(['Hello Aina,']))).html.includes('Stop these emails'));
});

test('a backslash in a session title is escaped in the calendar file', () => {
  const ics = calendarFile(sessionEvent({ id: 1, title: 'A\\B', kind: 'Clinics', startsAt: '2026-11-26T12:00:00Z', minutes: 60, link: 'https://meet.example/x', detail: '', going: 0, attending: false }));
  assert.ok(ics.includes('SUMMARY:A\\\\B\r\n'));
});

test('the newsletter confirmation has one button, says why it came, and when the link runs out', async () => {
  const letter = newsletterConfirmLetter({ email: 'aina@firm.com.my', link: 'https://club.test/newsletter/confirm?token=t', expiresAt: '2026-12-01T10:00:00Z' });
  assert.equal(letter.to, 'aina@firm.com.my');
  assert.equal(letter.from, undefined, 'it comes from the club, not a host');
  assert.equal(letter.unsubscribe, undefined, 'nobody is on the list yet');
  const { html, text } = await renderLetter(letter);
  assert.ok(html.includes('href="https://club.test/newsletter/confirm?token=t"'));
  assert.ok(html.includes('>Yes, send me the newsletter<'));
  assert.ok(text.includes('signed up for the newsletter from The Rest Is Accountancy with this address'));
  assert.ok(text.includes('The link works until 1 Dec 2026.'));
  assert.ok(text.includes("Didn't subscribe? Ignore this email."));
});
