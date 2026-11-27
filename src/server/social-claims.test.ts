import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import { createSocialClaims, daysLeft, emailDomain, evidenceType, isPersonalDomain, lapsesAt, monthOf } from './social-claims.ts';
import { createSocialProfiles } from './social-profiles.ts';

const PASSWORD = 'correct horse battery';
const DAY_MS = 86_400_000;

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

const world = () => {
  let clock = new Date('2026-11-26T02:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  const club = createClub(db, now);
  const profiles = createSocialProfiles(db, now);
  const claims = createSocialClaims(db, now);

  const joined = async (name: string, email: string, handle: string) => {
    const { memberId } = value(profiles.signUp({ name, email, handle }, { via: 'team' }));
    const accepted = await club.setPasswordFromLink(value(club.newLink(memberId)).token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  const host = club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });

  /** A member with a proven account and a ticked body claim: they show the seal. */
  const sealed = async (name: string, email: string, handle: string) => {
    const member = await joined(name, email, handle);
    const reviewer = (await host).id;
    const account = value(claims.addAccount(member.id, 'LinkedIn', handle.replace(/_/g, '-')));
    value(claims.decideAccount(account.id, reviewer, { verdict: 'approve' }));
    const body = value(claims.addClaim(member.id, { kind: 'body', bodyId: 'acca', status: 'Member', reference: '1234567', otherName: null, evidenceKey: null }));
    value(claims.decideClaim(body.id, reviewer, { verdict: 'approve' }));
    return member;
  };
  return { db, club, profiles, claims, joined, sealed, host, now, later: (ms: number) => (clock = new Date(clock.getTime() + ms)), at: (when: string) => (clock = new Date(when)) };
};

test('an account gets a random code, and the team proving it plus one ticked claim earns the seal', async () => {
  const w = world();
  const host = await w.host;
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');

  const account = value(w.claims.addAccount(priya.id, 'LinkedIn', 'priya-nair'));
  assert.match(account.code, /^TRIA-[A-Z2-9]{6}$/);
  assert.notEqual(value(w.claims.addAccount(priya.id, 'X', 'priyataxes')).code, account.code, 'each account has its own code');
  assert.equal(account.url, 'https://www.linkedin.com/in/priya-nair/');
  assert.equal(account.review.state, 'pending');
  assert.equal(w.profiles.profile('priyataxes')?.sealed, false);

  value(w.claims.decideAccount(account.id, host.id, { verdict: 'approve' }));
  assert.equal(w.profiles.profile('priyataxes')?.sealed, false, 'an account alone is not enough');

  const body = value(w.claims.addClaim(priya.id, { kind: 'body', bodyId: 'ctim', status: 'Student', reference: 'S1234', otherName: null, evidenceKey: null }));
  assert.equal(body.label, 'CTIM · Student');
  assert.equal(body.source, 'register');
  assert.equal(w.profiles.profile('priyataxes')?.sealed, false, 'a pending claim does not count');
  assert.equal(w.profiles.profile('priyataxes')?.track, 'field');

  value(w.claims.decideClaim(body.id, host.id, { verdict: 'approve' }));
  const shown = w.profiles.profile('priyataxes');
  assert.equal(shown?.sealed, true);
  assert.equal(shown?.track, 'training', 'a ticked student status puts them in training, exactly');

  assert.equal(w.claims.removeAccount(priya.id, account.id), true);
  assert.equal(w.profiles.profile('priyataxes')?.sealed, false, 'removing the proven account takes the seal with it');
});

test('accounts: one live per platform, handles that fit the platform, and one owner once proven', async () => {
  const w = world();
  const host = await w.host;
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const aina = await w.joined('Aina Rahman', 'aina@firm.my', 'aina');

  assert.equal(reason(w.claims.addAccount(priya.id, 'X', 'way_too_long_for_x_handles')), 'handle-invalid');
  assert.equal(reason(w.claims.addAccount(priya.id, 'Instagram', 'has space')), 'handle-invalid');
  const mine = value(w.claims.addAccount(priya.id, 'X', 'priya'));
  assert.equal(reason(w.claims.addAccount(priya.id, 'X', 'priya2')), 'platform-taken');

  const theirs = value(w.claims.addAccount(aina.id, 'X', 'priya'));
  value(w.claims.decideAccount(mine.id, host.id, { verdict: 'approve' }));
  assert.equal(reason(w.claims.decideAccount(theirs.id, host.id, { verdict: 'approve' })), 'proven-elsewhere', 'two people cannot both prove one account');
  assert.equal(reason(w.claims.addAccount((await w.joined('Dan Tan', 'dan@firm.my', 'dantan')).id, 'X', 'priya')), 'proven-elsewhere');

  const rejected = value(w.claims.decideAccount(theirs.id, host.id, { verdict: 'reject', reason: 'The code was not in the bio.' }));
  assert.deepEqual(rejected.item.review, { state: 'rejected', at: '2026-11-26T02:00:00Z', reason: 'The code was not in the bio.' });
  assert.equal(rejected.member.email, 'aina@firm.my');
  assert.equal(reason(w.claims.decideAccount(theirs.id, host.id, { verdict: 'approve' })), 'already', 'decided once, so the member hears once');
  assert.equal(value(w.claims.addAccount(aina.id, 'X', 'aina')).platform, 'X', 'a rejected account frees the platform');
});

test('removed rows never come back under the same id, so a decision always lands on what the reviewer read', async () => {
  const w = world();
  const host = await w.host;
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const first = value(w.claims.addClaim(priya.id, { kind: 'academic', role: 'Lecturer, Universiti Malaya', url: 'https://um.edu.my/staff/priya' }));
  assert.equal(w.claims.removeClaim(priya.id, first.id).removed, true);
  const second = value(w.claims.addClaim(priya.id, { kind: 'academic', role: 'Professor, Universiti Malaya', url: 'https://um.edu.my/staff/priya' }));
  assert.notEqual(second.id, first.id);
  assert.equal(reason(w.claims.decideClaim(first.id, host.id, { verdict: 'approve' })), 'not-found');

  const account = value(w.claims.addAccount(priya.id, 'TikTok', 'priyataxes'));
  w.claims.removeAccount(priya.id, account.id);
  assert.notEqual(value(w.claims.addAccount(priya.id, 'TikTok', 'someoneelse')).id, account.id);
  assert.equal(reason(w.claims.decideAccount(account.id, host.id, { verdict: 'approve' })), 'not-found');
});

test('the queue holds only what the team checks, split into accounts, credentials and documents', async () => {
  const w = world();
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  value(w.claims.addAccount(priya.id, 'Threads', 'priya.taxes'));
  const body = value(w.claims.addClaim(priya.id, { kind: 'body', bodyId: 'mia', status: 'Chartered Accountant', reference: '12345', otherName: null, evidenceKey: null }));
  const other = value(w.claims.addClaim(priya.id, { kind: 'body', bodyId: 'other', status: 'Member', reference: 'AICPA 998877', otherName: 'AICPA', evidenceKey: 'claims/1/a' }));
  const licence = value(w.claims.addClaim(priya.id, { kind: 'licence', licence: 'Licensed tax agent', reference: 'TA/123', until: '2027-06', evidenceKey: 'claims/1/b' }));
  const academic = value(w.claims.addClaim(priya.id, { kind: 'academic', role: 'Lecturer, Sunway', url: 'https://orcid.org/0000-0002-1825-0097' }));
  value(w.claims.addClaim(priya.id, { kind: 'experience', text: 'Six years in audit' }));
  value(w.claims.startWorkEmail(priya.id, 'priya@nair-tax.com.my'));

  const queue = w.claims.queue();
  assert.deepEqual(queue.accounts.map((q) => q.item.handle), ['priya.taxes']);
  assert.deepEqual(queue.credentials.map((q) => q.item.id), [body.id, academic.id]);
  assert.deepEqual(queue.documents.map((q) => q.item.id), [other.id, licence.id]);
  assert.equal(other.label, 'AICPA · Member');
  assert.equal(other.source, 'document');
  assert.equal(queue.documents[0]?.member.handle, 'priyataxes');
  assert.equal(w.claims.evidenceKey(other.id), 'claims/1/a');
  assert.equal(w.claims.evidenceKey(body.id), null);
});

test('a document is deleted once its claim is decided, and the decision is what is kept', async () => {
  const w = world();
  const host = await w.host;
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const licence = value(w.claims.addClaim(priya.id, { kind: 'licence', licence: 'Practising certificate', reference: 'PC 4411', until: '2027-12', evidenceKey: 'claims/1/pc' }));
  const other = value(w.claims.addClaim(priya.id, { kind: 'body', bodyId: 'other', status: 'Fellow', reference: 'X 1', otherName: 'ICAS', evidenceKey: 'claims/1/icas' }));

  const ticked = value(w.claims.decideClaim(licence.id, host.id, { verdict: 'approve' })).item;
  assert.equal(ticked.until, '2027-12', 'a licence runs to the month on it');
  value(w.claims.decideClaim(other.id, host.id, { verdict: 'reject', reason: 'The certificate was unreadable.' }));
  assert.equal(w.claims.evidenceKey(licence.id), null, 'the team can no longer open it');
  assert.deepEqual(w.claims.staleEvidence(), [{ claimId: licence.id, key: 'claims/1/pc' }, { claimId: other.id, key: 'claims/1/icas' }]);
  w.claims.evidenceDeleted(licence.id);
  w.claims.evidenceDeleted(other.id);
  assert.deepEqual(w.claims.staleEvidence(), []);
  assert.equal(w.claims.mine(priya.id).claims.find((c) => c.id === other.id)?.review.state, 'rejected');

  const pending = value(w.claims.addClaim(priya.id, { kind: 'licence', licence: 'Licensed tax agent', reference: 'TA 1', until: '2027-01', evidenceKey: 'claims/1/ta' }));
  assert.deepEqual(w.claims.removeClaim(priya.id, pending.id), { removed: true, evidenceKey: 'claims/1/ta' }, 'the caller deletes the file');
  assert.deepEqual(w.claims.removeClaim(priya.id, pending.id), { removed: false, evidenceKey: null });
});

test('body ticks run a year, and a renewed tick replaces the older one', async () => {
  const w = world();
  const host = await w.host;
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const student = value(w.claims.addClaim(priya.id, { kind: 'body', bodyId: 'acca', status: 'Student', reference: '1', otherName: null, evidenceKey: null }));
  assert.equal(value(w.claims.decideClaim(student.id, host.id, { verdict: 'approve' })).item.until, '2027-11');

  assert.equal(reason(w.claims.addClaim(priya.id, { kind: 'academic', role: 'Tutor', url: 'https://a.edu/t' })), null);
  assert.equal(reason(w.claims.addClaim(priya.id, { kind: 'academic', role: 'Tutor', url: 'https://a.edu/t' })), 'duplicate', 'the same claim waiting twice');

  w.later(200 * DAY_MS);
  const member = value(w.claims.addClaim(priya.id, { kind: 'body', bodyId: 'acca', status: 'Member', reference: '1', otherName: null, evidenceKey: null }));
  value(w.claims.decideClaim(member.id, host.id, { verdict: 'approve' }));
  const ledger = w.claims.ledger(priya.id, null).claims;
  assert.deepEqual(ledger.map((c) => [c.label, c.until]), [['ACCA · Member', '2028-06']], 'the student tick is replaced, not shown twice');
  assert.equal(w.profiles.profile('priyataxes')?.track, 'qualified');
});

test('a tick lapses when its month ends in Malaysia, and reminders go at 60 and 14 days, once each', async () => {
  assert.equal(lapsesAt('2026-12').toISOString(), '2026-12-31T16:00:00.000Z', 'midnight on 1 January in Kuala Lumpur');
  assert.equal(daysLeft('2026-12', new Date('2026-12-31T15:59:00Z')), 1);
  assert.equal(daysLeft('2026-12', new Date('2026-12-31T16:00:00Z')), 0);
  assert.equal(monthOf(new Date('2026-11-30T17:00:00Z')), '2026-12', 'already December in Kuala Lumpur');
  assert.equal(monthOf(new Date('2026-11-26T02:00:00Z'), 12), '2027-11');

  const w = world();
  const host = await w.host;
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const ta = value(w.claims.addClaim(priya.id, { kind: 'licence', licence: 'Licensed tax agent', reference: 'TA', until: '2027-02', evidenceKey: 'k1' }));
  const pc = value(w.claims.addClaim(priya.id, { kind: 'licence', licence: 'Practising certificate', reference: 'PC', until: '2026-12', evidenceKey: 'k2' }));
  value(w.claims.decideClaim(ta.id, host.id, { verdict: 'approve' }));

  w.at('2026-12-25T02:00:00Z');
  value(w.claims.decideClaim(pc.id, host.id, { verdict: 'approve' }));
  const first = w.claims.dueRenewals();
  assert.deepEqual(first.map((r) => [r.claim.label, r.daysLeft]), [['Practising certificate', 7]], 'first seen inside 14 days: one reminder; 66 days out: none yet');
  assert.equal(first[0]?.member.email, 'priya@tax.my');
  assert.deepEqual(w.claims.dueRenewals(), [], 'each reminder goes once');

  w.at('2027-01-01T00:00:00Z');
  assert.deepEqual(w.claims.dueRenewals().map((r) => [r.claim.label, r.daysLeft]), [['Licensed tax agent', 59]]);
  assert.equal(w.claims.lapse(), 1);
  assert.equal(w.claims.lapse(), 0, 'safe to rerun');
  const pcNow = w.claims.ledger(priya.id, null).claims.find((c) => c.label === 'Practising certificate');
  assert.equal(pcNow?.review.state, 'lapsed', 'still shown, struck through');

  w.at('2027-02-16T00:00:00Z');
  assert.deepEqual(w.claims.dueRenewals().map((r) => [r.claim.label, r.daysLeft]), [['Licensed tax agent', 13]]);
  assert.deepEqual(w.claims.dueRenewals(), []);
});

test('work email: personal addresses are refused, and only the member who asked can confirm the link', async () => {
  assert.equal(emailDomain('Priya@Nair-Tax.com.MY'), 'nair-tax.com.my');
  assert.equal(emailDomain('no-at-sign'), null);
  assert.equal(isPersonalDomain('gmail.com'), true);
  assert.equal(isPersonalDomain('mail.yahoo.com'), true);
  assert.equal(isPersonalDomain('kpmg.com.my'), false);

  const w = world();
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const aina = await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  assert.equal(reason(w.claims.startWorkEmail(priya.id, 'priya@gmail.com')), 'personal-domain');
  assert.equal(reason(w.claims.startWorkEmail(priya.id, 'priya@localhost')), 'address-invalid');

  const check = value(w.claims.startWorkEmail(priya.id, 'priya@nair-tax.com.my'));
  assert.equal(check.claim.label, 'Works at nair-tax.com.my');
  assert.equal(check.claim.review.state, 'pending');
  assert.equal(check.expiresAt, '2026-12-03T02:00:00Z', 'seven days');
  assert.equal(reason(w.claims.startWorkEmail(priya.id, 'priya@nair-tax.com.my')), 'too-soon', 'one link per few minutes');
  assert.deepEqual(w.claims.workEmail(check.token), { claimId: check.claim.id, memberId: priya.id, name: 'Priya Nair', handle: 'priyataxes', domain: 'nair-tax.com.my' });

  assert.equal(reason(w.claims.confirmWorkEmail(aina.id, check.token)), 'not-yours', 'a scanner or a stranger opening the link ticks nothing');
  w.later(11 * 60_000);
  const again = value(w.claims.startWorkEmail(priya.id, 'p.nair@nair-tax.com.my'));
  assert.equal(again.claim.id, check.claim.id, 'the same domain is the same claim');
  assert.equal(w.claims.workEmail(check.token), null, 'a new link retires the old one');

  const ticked = value(w.claims.confirmWorkEmail(priya.id, again.token));
  assert.equal(ticked.review.state, 'ticked');
  assert.equal(ticked.source, 'email');
  assert.equal(reason(w.claims.confirmWorkEmail(priya.id, again.token)), 'not-found', 'the link works once');
  assert.equal(reason(w.claims.startWorkEmail(priya.id, 'priya@nair-tax.com.my')), 'already-ticked');

  const late = value(w.claims.startWorkEmail(aina.id, 'aina@rahman.my'));
  w.later(8 * DAY_MS);
  assert.equal(reason(w.claims.confirmWorkEmail(aina.id, late.token)), 'not-found', 'out of date after seven days');
});

test('experience is self-declared until three sealed peers vouch, and nobody vouches for themselves or twice', async () => {
  const w = world();
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const claim = value(w.claims.addClaim(priya.id, { kind: 'experience', text: 'Six years in audit' }));
  assert.equal(claim.source, 'self');
  assert.equal(w.claims.queue().credentials.length, 0, 'the team does not check experience');

  const unsealed = await w.joined('New Person', 'new@firm.my', 'newperson');
  const [a, b, c] = [await w.sealed('Aina Rahman', 'aina@firm.my', 'aina'), await w.sealed('Dan Tan', 'dan@firm.my', 'dantan'), await w.sealed('Mei Ling', 'mei@firm.my', 'meiling')];
  assert.equal(reason(w.claims.vouch(unsealed.id, claim.id)), 'no-seal');
  assert.equal(reason(w.claims.vouch(priya.id, claim.id)), 'self');
  assert.equal(reason(w.claims.vouch(a.id, 999)), 'not-found');

  assert.equal(value(w.claims.vouch(a.id, claim.id)).vouches, 1);
  assert.equal(reason(w.claims.vouch(a.id, claim.id)), 'already');
  assert.equal(value(w.claims.vouch(b.id, claim.id)).review.state, 'pending');
  const ticked = value(w.claims.vouch(c.id, claim.id));
  assert.equal(ticked.review.state, 'ticked');
  assert.equal(ticked.source, 'vouch');
  assert.equal(ticked.vouches, 3);

  const seen = w.claims.ledger(priya.id, a.id).claims.find((x) => x.id === claim.id);
  assert.equal(seen?.vouchedByViewer, true);
  assert.equal(w.claims.ledger(priya.id, null).claims[0]?.vouchedByViewer, false);
  assert.equal(w.profiles.profile('priyataxes')?.sealed, false, 'vouched experience without a proven account is no seal');
});

test('the ledger shows ticked, lapsed and self-declared claims, and keeps pending, rejected and references private', async () => {
  const w = world();
  const host = await w.host;
  const priya = await w.joined('Priya Nair', 'priya@tax.my', 'priyataxes');
  const ticked = value(w.claims.addClaim(priya.id, { kind: 'body', bodyId: 'micpa', status: 'Member', reference: 'SECRET-1', otherName: null, evidenceKey: null }));
  value(w.claims.decideClaim(ticked.id, host.id, { verdict: 'approve' }));
  const rejected = value(w.claims.addClaim(priya.id, { kind: 'academic', role: 'Lecturer', url: 'https://x.edu/p' }));
  value(w.claims.decideClaim(rejected.id, host.id, { verdict: 'reject', reason: 'Not on the staff page.' }));
  value(w.claims.addClaim(priya.id, { kind: 'licence', licence: 'Licensed tax agent', reference: 'TA', until: '2027-06', evidenceKey: 'k' }));
  value(w.claims.addClaim(priya.id, { kind: 'experience', text: 'Ten years in tax' }));
  const pendingAccount = value(w.claims.addAccount(priya.id, 'YouTube', 'priyataxes'));

  const ledger = w.claims.ledger(priya.id, null);
  assert.deepEqual(ledger.claims.map((c) => [c.label, c.review.state]), [['MICPA · Member', 'ticked'], ['Ten years in tax', 'pending']]);
  assert.ok(ledger.claims.every((c) => !('reference' in c)), 'member numbers stay with the team');
  assert.deepEqual(ledger.accounts, [], 'a pending account is not shown');
  assert.equal(w.claims.mine(priya.id).accounts[0]?.id, pendingAccount.id, 'the member sees their own');
  assert.equal(w.claims.mine(priya.id).claims.find((c) => c.id === rejected.id)?.review.state, 'rejected');
});

test('evidence is a PDF, JPEG, PNG or WebP by its first bytes, whatever its name says', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  assert.equal(evidenceType(bytes('%PDF-1.7\n')), 'application/pdf');
  assert.equal(evidenceType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(evidenceType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(evidenceType(bytes('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(evidenceType(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>')), null, 'an SVG can carry script');
  assert.equal(evidenceType(bytes('<!doctype html>')), null);
  assert.equal(evidenceType(new Uint8Array()), null);
});

test('ticks show on a profile, so a member without a handle adds no account, claim or work email', async () => {
  const w = world();
  const clubOnly = await w.club.ensureAdmin({ email: 'siti@club.test', name: 'Siti', password: PASSWORD });
  assert.equal(reason(w.claims.addAccount(clubOnly.id, 'LinkedIn', 'siti')), 'no-handle');
  assert.equal(reason(w.claims.addClaim(clubOnly.id, { kind: 'experience', text: 'Six years in audit' })), 'no-handle');
  assert.equal(reason(w.claims.startWorkEmail(clubOnly.id, 'siti@kpmg.com')), 'no-handle');
  assert.deepEqual(w.claims.mine(clubOnly.id), { accounts: [], claims: [] });
});
