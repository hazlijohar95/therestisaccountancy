import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TERMS, everyRate } from '../data/membership.ts';
import { renderLetter } from '../emails/render.tsx';
import type { Member, PasswordLink } from './club.ts';
import { passwordLetter, passwordLetterFor, paymentDueLetter, renewalLetter, renewalNoticeLetter } from './letters.ts';

const aina = { email: 'aina@firm.com.my', name: 'Aina Rahman' };
const payUrl = 'https://club.test/members/pay';
const NO_COUNTS = { session: 0, post: 0, lesson: 0, call: 0, plan: 0 };
const notice = { term: 'year', chargesAt: '2027-01-30T22:00:00Z', accountUrl: 'https://club.test/members/account', upcoming: [] } as const;

test('the invitation names both rates', async () => {
  const letter = passwordLetter({ ...aina, purpose: 'welcome', link: 'https://club.test/welcome?token=t', expiresAt: '2026-12-01T00:00:00Z', rate: everyRate, welcomeTo: 'club' });
  const { text } = await renderLetter(letter);
  assert.ok(text.includes('Membership is RM 99 a month or RM 990 a year.'));
  assert.ok(!text.includes('first month'));
});

test('someone joining Social is asked to finish joining, and told it is free', async () => {
  const letter = passwordLetter({ ...aina, purpose: 'welcome', link: 'https://club.test/welcome?token=t', expiresAt: '2026-12-01T00:00:00Z', rate: null, welcomeTo: 'social' });
  assert.equal(letter.subject, 'Set a password to finish joining');
  const { text, html } = await renderLetter(letter);
  assert.ok(text.includes('There is nothing to pay.'));
  assert.ok(html.includes('>Set your password<'));
  assert.ok(!text.includes('Membership') && !text.includes('admin'), 'no club membership or admin copy');

  const reset = passwordLetter({ ...aina, purpose: 'reset', link: 'https://club.test/welcome?token=t', expiresAt: '2026-12-01T00:00:00Z', rate: null, welcomeTo: 'social' });
  assert.equal(reset.subject, 'Reset your password', 'a reset reads the same for everyone');
});

test('a link the club issues tells only a club member who may pay the rate, and lands on /welcome', async () => {
  const issued = (role: Member['role'], clubApproved: boolean): PasswordLink => ({
    member: { id: 1, ...aina, role, status: 'invited', joinedAt: '2026-11-01T00:00:00Z', joinedVia: clubApproved ? 'club' : 'social', clubApproved },
    purpose: 'welcome',
    token: 'a b',
    expiresAt: '2026-12-01T00:00:00Z',
  });

  const club = passwordLetterFor(issued('member', true), 'https://club.test');
  const clubText = (await renderLetter(club)).text;
  assert.ok(clubText.includes('Membership is RM 99 a month or RM 990 a year.'));
  assert.ok(clubText.includes('https://club.test/welcome?token=a%20b'));

  const social = passwordLetterFor(issued('member', false), 'https://club.test');
  assert.equal(social.subject, 'Set a password to finish joining');

  const admin = (await renderLetter(passwordLetterFor(issued('admin', true), 'https://club.test'))).text;
  assert.ok(!admin.includes('Membership is'), 'admins are never told a rate');
});

test('the payment-due letter names the term the member paid for, and its rate', async () => {
  const year = paymentDueLetter(aina, { term: 'year', paidUntil: '2027-01-31T10:00:00Z', payUrl });
  assert.equal(year.subject, 'Your paid year ends on 31 Jan 2027');
  const yearly = await renderLetter(year);
  assert.ok(yearly.text.includes('Your paid year ends on 31 Jan 2027.'));
  assert.ok(yearly.text.includes('(RM 990 a year)'));
  assert.ok(yearly.html.includes('>Pay for next year<'));
  assert.ok(yearly.text.includes('You can change between paying by the month and by the year on the same page.'));
  assert.ok(!yearly.text.includes('RM 99 a month'));

  const month = paymentDueLetter(aina, { term: 'month', paidUntil: '2026-02-28T10:00:00Z', payUrl });
  assert.equal(month.subject, 'Your paid month ends on 28 Feb 2026');
  const monthly = await renderLetter(month);
  assert.ok(monthly.text.includes('(RM 99 a month)'));
  assert.ok(monthly.html.includes('>Pay for next month<'));
  assert.ok(!monthly.text.includes('RM 990'));
});

test('the failed-renewal letter names what the card was charged for', async () => {
  const declined = await renderLetter(renewalLetter(aina, { term: 'year', cardRefused: false, accessUntil: '2027-02-03T10:00:00Z', payUrl }));
  assert.ok(declined.text.includes('We tried to charge your card RM 990 for your next year, but the payment was declined.'));
  const refused = await renderLetter(renewalLetter(aina, { term: 'month', cardRefused: true, accessUntil: '2026-03-03T10:00:00Z', payUrl }));
  assert.ok(refused.text.includes("We tried to charge your card RM 99 for your next month, but the card can't be charged any more."));
});

test('every term has a letter of each kind that renders', async () => {
  for (const term of TERMS) {
    for (const letter of [paymentDueLetter(aina, { term, paidUntil: '2027-01-31T10:00:00Z', payUrl }), renewalLetter(aina, { term, cardRefused: false, accessUntil: '2027-02-03T10:00:00Z', payUrl })]) {
      const { html, text } = await renderLetter(letter);
      assert.ok(html.includes(payUrl) && text.includes(payUrl));
    }
  }
});

test('the renewal notice names the date, the amount and how to stop it', async () => {
  const letter = renewalNoticeLetter(aina, { term: 'year', chargesAt: '2027-01-30T22:00:00Z', accountUrl: 'https://club.test/members/account', counts: NO_COUNTS, upcoming: [] });
  assert.equal(letter.subject, 'Your membership renews on 31 Jan 2027');
  const { text } = await renderLetter(letter);
  assert.ok(text.includes('charge RM 990 to the card you saved'));
  assert.ok(text.includes('https://club.test/members/account'));
});

test('the renewal notice recaps the year with only what the member did', async () => {
  const letter = renewalNoticeLetter(aina, { ...notice, counts: { session: 4, post: 12, lesson: 3, call: 1, plan: 0 } });
  const { lines } = letter;
  assert.equal(lines[1], 'On 31 Jan 2027 we renew your membership for another year and charge RM 990 to the card you saved.');
  assert.equal(lines[2], 'In your last year you said yes to 4 sessions, posted 12 times, finished 3 lessons and booked 1 call.');
  assert.ok(lines[3]?.toString().startsWith('Nothing to do if that suits you.'), 'the existing lines follow, unchanged');

  const some = await renderLetter(renewalNoticeLetter(aina, { ...notice, counts: { session: 1, post: 0, lesson: 0, call: 0, plan: 2 } }));
  assert.ok(some.text.includes('In your last year you said yes to 1 session and worked on your plan.'));
  const one = await renderLetter(renewalNoticeLetter(aina, { ...notice, counts: { session: 0, post: 1, lesson: 0, call: 0, plan: 0 } }));
  assert.ok(one.text.includes('In your last year you posted 1 time.'));
});

test('the renewal notice has no recap when the member did nothing', async () => {
  const letter = renewalNoticeLetter(aina, { ...notice, counts: NO_COUNTS });
  assert.ok(!letter.lines.some((line) => typeof line === 'string' && line.startsWith('In your last')));
  assert.equal(letter.lines.length, 5);
});

test('the renewal notice lists the sessions coming up', async () => {
  const letter = renewalNoticeLetter(aina, {
    ...notice,
    counts: NO_COUNTS,
    upcoming: [
      { title: 'Pricing clinic', startsAt: '2027-01-12T11:00:00Z' },
      { title: 'Year-end close', startsAt: '2027-01-19T11:00:00Z' },
    ],
  });
  const at = letter.lines.indexOf('Coming up:');
  assert.ok(at > 0);
  assert.deepEqual(letter.lines.slice(at + 1, at + 3), ['Pricing clinic, 12 Jan 2027, 7:00 pm', 'Year-end close, 19 Jan 2027, 7:00 pm']);
  const { text } = await renderLetter(letter);
  assert.ok(text.includes('Coming up:') && text.includes('Pricing clinic, 12 Jan 2027, 7:00 pm'));
});
