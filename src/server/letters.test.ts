import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLetter } from '../emails/render.tsx';
import { calendarFile, sessionEvent } from './calendar.ts';
import { newsletterConfirmLetter, onboardingLetter, type Letter } from './letters.ts';

const letter = (lines: Parameters<typeof renderLetter>[0]['lines'], unsubscribe?: Letter['unsubscribe']) => ({ to: 'aina@firm.com.my', subject: 'Hello', lines, ...(unsubscribe && { unsubscribe }) });

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
  const { html } = await renderLetter(letter(['Hello Aina,', 'News.'], { url: 'https://therestisaccountancy.com/unsubscribe?t=x', list: 'digest' }));
  assert.ok(html.includes('href="https://therestisaccountancy.com/unsubscribe?t=x"'));
  assert.ok(html.includes('choose which you get'), 'a list the account page controls also links there');
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

test('a getting-started email comes from the host, names the real sessions, asks one thing and can be stopped in one click', async () => {
  const to = { email: 'aina@firm.com.my', name: 'Aina Rahman', key: 'k1' };
  const news = { sessions: [{ title: 'Pricing clinic', startsAt: '2026-12-10T12:00:00Z' }], sessionsUrl: 'https://therestisaccountancy.com/members/sessions', settingsUrl: 'https://therestisaccountancy.com/members/account#email' };
  for (const step of [0, 1, 2] as const) {
    const letter = onboardingLetter(to, step, news);
    assert.equal(letter.from, 'Hazli from The Rest Is Accountancy');
    assert.deepEqual(letter.unsubscribe, { url: 'https://therestisaccountancy.com/unsubscribe?k=k1&list=onboarding', list: 'onboarding' });
    const { html, text } = await renderLetter(letter);
    assert.ok(text.includes('Pricing clinic'), `step ${step} names the session`);
    assert.ok(text.includes('\nHi Aina,\n'), `step ${step} greets by first name`);
    assert.equal([...html.matchAll(/href="https:\/\/therestisaccountancy\.com\/members\/sessions"/g)].length, 1, `step ${step} has one thing to do`);
    assert.ok(!html.includes('choose which you get'), `step ${step} does not offer settings that cannot stop it`);
  }
  assert.ok((await renderLetter(onboardingLetter(to, 1, news))).text.includes('Clinics: An open floor.'), 'the second explains the kinds of session');
});
