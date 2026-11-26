import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TERMS, everyRate } from '../data/membership.ts';
import { renderLetter } from '../emails/render.tsx';
import { passwordLetter, paymentDueLetter, renewalLetter, renewalNoticeLetter } from './letters.ts';

const aina = { email: 'aina@firm.com.my', name: 'Aina Rahman' };
const payUrl = 'https://club.test/members/pay';

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
  const letter = renewalNoticeLetter(aina, { term: 'year', chargesAt: '2027-01-30T22:00:00Z', accountUrl: 'https://club.test/members/account' });
  assert.equal(letter.subject, 'Your membership renews on 31 Jan 2027');
  const { text } = await renderLetter(letter);
  assert.ok(text.includes('charge RM 990 to the card you saved'));
  assert.ok(text.includes('https://club.test/members/account'));
});
