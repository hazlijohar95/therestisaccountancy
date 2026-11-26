import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLetter } from '../emails/render.tsx';
import { createClub } from './club.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import { createSocialClaims } from './social-claims.ts';
import { accountDecidedLetter, claimDecidedLetter, requestApprovedLetter, requestDeclinedLetter, teamInviteLetter, tickRenewalLetter, workEmailLetter } from './social-letters.ts';
import { createSocialProfiles } from './social-profiles.ts';

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};

const world = async () => {
  const now = () => new Date('2026-11-26T02:00:00Z');
  const db = openDatabase(':memory:');
  const club = createClub(db, now);
  const reviewer = await club.ensureAdmin({ email: 'host@club.test', name: 'Hazli Johar', password: 'correct horse battery' });
  const { memberId } = value(createSocialProfiles(db, now).signUp({ name: 'Priya Nair', email: 'priya@tax.my', handle: 'priyataxes' }, { via: 'team' }));
  return { claims: createSocialClaims(db, now), reviewer, memberId };
};

const urls = { profile: 'https://social.test/@priyataxes', verify: 'https://social.test/verify' };

test('a rejection goes to the member’s own address, from the reviewer, with the reason and a way back', async () => {
  const w = await world();
  const account = value(w.claims.addAccount(w.memberId, 'X', 'priyataxes'));
  const decided = value(w.claims.decideAccount(account.id, w.reviewer.id, { verdict: 'reject', reason: 'The code was not in the bio.' }));
  const letter = accountDecidedLetter(decided.member, decided.item, w.reviewer, urls.verify);
  assert.equal(letter.to, 'priya@tax.my');
  assert.equal(letter.from, 'Hazli from The Rest Is Accountancy Social');
  const { text, html } = await renderLetter(letter);
  assert.ok(text.includes('The code was not in the bio.'));
  assert.ok(html.includes('href="https://social.test/verify"'));
});

test('a ticked document says the file is gone and when the tick runs to', async () => {
  const w = await world();
  const claim = value(w.claims.addClaim(w.memberId, { kind: 'licence', licence: 'Licensed tax agent', reference: 'TA 1', until: '2027-06', evidenceKey: 'k' }));
  const decided = value(w.claims.decideClaim(claim.id, w.reviewer.id, { verdict: 'approve' }));
  const { text } = await renderLetter(claimDecidedLetter(decided.member, decided.item, w.reviewer, urls));
  assert.ok(text.includes('runs to the end of Jun 2027'));
  assert.ok(text.includes('The document you sent has been deleted.'));
});

test('the work-email link goes to the work address and promises only the domain shows', async () => {
  const letter = workEmailLetter({ address: 'priya@nair-tax.com.my', name: 'Priya Nair', handle: 'priyataxes', domain: 'nair-tax.com.my', link: 'https://social.test/verify/email?token=t', expiresAt: '2026-12-03T02:00:00Z' });
  assert.equal(letter.to, 'priya@nair-tax.com.my');
  const { text } = await renderLetter(letter);
  assert.ok(text.includes('Priya Nair (@priyataxes) asked'));
  assert.ok(text.includes('Only the domain shows on the profile'));
  assert.ok(!/!/.test(text.replace(/<!--.*?-->/g, '')), 'no exclamation marks');
});

test('a renewal reminder counts the days and says what happens if it lapses', async () => {
  const w = await world();
  const claim = value(w.claims.addClaim(w.memberId, { kind: 'licence', licence: 'Practising certificate', reference: 'PC', until: '2026-12', evidenceKey: 'k' }));
  const ticked = value(w.claims.decideClaim(claim.id, w.reviewer.id, { verdict: 'approve' }));
  const letter = tickRenewalLetter({ claim: ticked.item, member: ticked.member, daysLeft: 14 }, urls.verify);
  assert.equal(letter.subject, 'Your “Practising certificate” tick runs out in 14 days');
  assert.ok((await renderLetter(letter)).text.includes('struck through in red'));
});

test('a team invite comes from the person who sent it, with a link that works once', async () => {
  const letter = teamInviteLetter({ email: 'siti@firm.my', name: 'Siti Aminah' }, { name: 'Hazli Johar' }, { link: 'https://social.test/sign-up?invite=abc', expiresAt: '2026-12-10T02:00:00Z' });
  assert.equal(letter.to, 'siti@firm.my');
  assert.equal(letter.from, 'Hazli from The Rest Is Accountancy Social');
  const { text, html } = await renderLetter(letter);
  assert.ok(text.includes('Hi Siti,'));
  assert.ok(html.includes('href="https://social.test/sign-up?invite=abc"'));
});

test('an approved request sends a newcomer the password link, and someone who signs in already only a way to sign in', async () => {
  const welcome = await renderLetter(requestApprovedLetter({ email: 'siti@firm.my', name: 'Siti' }, { link: 'https://test/welcome?token=t', expiresAt: '2026-12-10T02:00:00Z' }));
  assert.ok(welcome.html.includes('href="https://test/welcome?token=t"'));
  assert.ok(welcome.text.includes('pick your handle'));
  const signIn = await renderLetter(requestApprovedLetter({ email: 'aina@firm.my', name: 'Aina' }, { signIn: 'https://test/sign-in', hasProfile: true }));
  assert.ok(signIn.html.includes('href="https://test/sign-in"'));
  assert.equal(signIn.text.includes('password'), false, 'nobody who has a password is sent a reset');
});

test('a declined request is told kindly, with the way in that still works', async () => {
  const { text } = await renderLetter(requestDeclinedLetter({ email: 'siti@firm.my', name: 'Siti' }));
  assert.ok(text.includes('If a member invites you'));
});
