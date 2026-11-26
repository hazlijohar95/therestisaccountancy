import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLetter } from '../emails/render.tsx';
import { GRACE_MS } from './billing.ts';
import type { Invitation, Member, PasswordLink } from './club.ts';
import { directorySummary, listingApprovedLetter, listingQueuedLetter, listingReturnedLetter, type ListingContent } from './listings.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import { createStore } from './store.ts';

const SITE = 'https://therestisaccountancy.com/';

const PASSWORD = 'correct horse battery';

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

/** The password link an accepted join request sent. */
const sentLink = (result: Result<Invitation, string>): PasswordLink => {
  const invitation = value(result);
  assert.ok(invitation.kind === 'link', 'expected a password link');
  return invitation.link;
};

const practice = (changes: Partial<ListingContent> = {}): ListingContent => ({
  practice: 'Rahman & Co',
  state: 'Selangor',
  town: 'Petaling Jaya',
  remote: false,
  services: ['bookkeeping', 'company-tax'],
  niche: 'Clinics and dental practices',
  bio: 'I keep the books and file the tax for about forty small companies, most of them clinics.',
  qualifications: 'Chartered Accountant, ACCA',
  website: 'https://rahman.example',
  contactEmail: 'hello@rahman.example',
  ...changes,
});

const world = async () => {
  let clock = new Date('2026-11-25T02:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  const { club, billing, listings } = createStore(db, now);
  const host = await club.ensureAdmin({ email: 'host@club.test', name: 'Hazli Johar', password: PASSWORD });

  /** A member who has set a password and paid for a month, by FPX so nothing renews by card. */
  const member = async (name: string, email: string): Promise<Member> => {
    club.recordJoinRequest({ name, email, stage: 'I run a practice' });
    const request = club.joinRequests({ decided: false }).find((r) => r.email === email);
    assert.ok(request);
    const accepted = await club.setPasswordFromLink(sentLink(club.inviteFromRequest(request.id)).token, PASSWORD);
    assert.ok(accepted);
    billing.opened(`checkout-${accepted.member.id}`, accepted.member.id, 'checkout', 'month');
    billing.paid(`checkout-${accepted.member.id}`, false);
    return accepted.member;
  };

  /** Saves a listing and has the host approve it. */
  const listed = (memberId: number, content: ListingContent) => value(listings.approve(memberId, host.id, listings.save(memberId, content).listing.updatedAt));

  const later = (ms: number) => (clock = new Date(clock.getTime() + ms));
  const inDirectory = () => listings.directory({}).matches.map((l) => l.practice);
  return { club, billing, listings, host, member, listed, now, later, inDirectory };
};

test('a new listing waits for a host, and approving it puts it in the directory', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');

  const saved = w.listings.save(aina.id, practice());
  assert.equal(saved.outcome, 'submitted');
  assert.deepEqual(saved.listing.review, { state: 'pending' });
  assert.equal(saved.listing.shown, false);
  assert.deepEqual(w.listings.directory({}), { total: 0, matches: [], anywhere: [] }, 'nobody sees it before a check');

  const approved = value(w.listings.approve(aina.id, w.host.id, saved.listing.updatedAt));
  assert.equal(approved.review.state, 'listed');
  assert.equal(approved.shown, true);
  assert.equal(reason(w.listings.approve(aina.id, w.host.id, saved.listing.updatedAt)), 'already', 'a second approval sends nothing');

  const [entry] = w.listings.directory({}).matches;
  assert.equal(entry?.practice, 'Rahman & Co');
  assert.equal(entry?.name, 'Aina Rahman');
  assert.equal(entry?.contactEmail, 'hello@rahman.example');
  assert.ok(entry && !('email' in entry) && !('review' in entry), 'the account email and the review stay off the public page');
});

test('a host approves only the version they read', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const read = w.listings.save(aina.id, practice()).listing.updatedAt;

  w.later(60_000);
  const edited = w.listings.save(aina.id, practice({ bio: 'Something the host has not read.' }));
  assert.equal(edited.outcome, 'updated', 'an edit while it waits stays in the queue');
  assert.equal(reason(w.listings.approve(aina.id, w.host.id, read)), 'changed');
  assert.equal(reason(w.listings.sendBack(aina.id, read, 'Add your town.')), 'changed');
  assert.equal(value(w.listings.approve(aina.id, w.host.id, edited.listing.updatedAt)).review.state, 'listed');
  assert.equal(reason(w.listings.approve(999, w.host.id, read)), 'not-found');
});

test('a returned listing stays out with its note, and saving it sends it back for a check', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const saved = w.listings.save(aina.id, practice());

  const returned = value(w.listings.sendBack(aina.id, saved.listing.updatedAt, 'Your website does not load. Check the address.'));
  assert.deepEqual(returned.review, { state: 'returned', note: 'Your website does not load. Check the address.' });
  assert.equal(returned.shown, false);

  w.later(60_000);
  const again = w.listings.save(aina.id, practice({ website: 'https://www.rahman.example' }));
  assert.equal(again.outcome, 'resubmitted');
  assert.deepEqual(again.listing.review, { state: 'pending' }, 'the note is gone once they answer it');
});

test('an approved listing can be taken down with a note', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const listed = w.listed(aina.id, practice());

  const returned = value(w.listings.sendBack(aina.id, listed.updatedAt, 'Members only: your membership has lapsed.'));
  assert.equal(returned.review.state, 'returned');
  assert.deepEqual(w.inDirectory(), []);
  assert.equal(reason(w.listings.sendBack(aina.id, listed.updatedAt, 'Again.')), 'already');
});

test('changing a listed practice takes it out until a host checks it again, and saving it unchanged does not', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  w.listed(aina.id, practice());

  const same = w.listings.save(aina.id, practice({ services: ['company-tax', 'bookkeeping', 'bookkeeping'] }));
  assert.equal(same.outcome, 'unchanged', 'the same services in another order are the same listing');
  assert.equal(same.listing.review.state, 'listed');
  assert.deepEqual(w.inDirectory(), ['Rahman & Co']);

  w.later(60_000);
  const moved = w.listings.save(aina.id, practice({ town: 'Shah Alam' }));
  assert.equal(moved.outcome, 'resubmitted');
  assert.deepEqual(moved.listing.review, { state: 'pending' });
  assert.deepEqual(w.inDirectory(), [], 'unchecked content never shows');
});

test('pausing hides a practice and unpausing brings it back, without a new check', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const listed = w.listed(aina.id, practice());

  const paused = w.listings.setPaused(aina.id, true);
  assert.equal(paused?.shown, false);
  assert.deepEqual(paused?.review, listed.review, 'approval is untouched');
  assert.deepEqual(w.inDirectory(), []);

  const back = w.listings.setPaused(aina.id, false);
  assert.equal(back?.shown, true);
  assert.deepEqual(back?.review, listed.review);
  assert.equal(w.listings.setPaused(999, true), null, 'nothing to pause before a listing exists');

  const bilal = await w.member('Bilal Osman', 'bilal@firm.com.my');
  const waiting = w.listings.save(bilal.id, practice({ practice: 'Osman Accounting' })).listing;
  w.listings.setPaused(bilal.id, true);
  const approved = value(w.listings.approve(bilal.id, w.host.id, waiting.updatedAt));
  assert.equal(approved.review.state, 'listed', 'pausing does not get in the way of a host who read it before');
  assert.equal(approved.shown, false, 'and it stays hidden until the member unpauses');
});

test('the directory shows a listing only while its member is active and paid up, as for the members area', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  w.listed(aina.id, practice());
  const shown = () => w.listings.listing(aina.id)?.shown;
  const agrees = (when: string) => {
    assert.equal(shown(), w.billing.access(aina.id) !== 'unpaid', `shown matches the members area ${when}`);
    assert.equal(w.inDirectory().length === 1, shown(), `the directory agrees ${when}`);
  };

  agrees('while paid');
  assert.equal(shown(), true);

  value(w.club.suspendMember(w.host.id, aina.id, SITE));
  assert.equal(shown(), false, 'a suspended member is not shown');
  value(w.club.reinstateMember(aina.id));
  assert.equal(shown(), true);

  const paidUntil = w.billing.standing(aina.id).paidUntil;
  assert.ok(paidUntil);
  w.later(new Date(paidUntil).getTime() - w.now().getTime() - 60_000);
  agrees('a minute before the month ends');
  w.later(2 * 60_000);
  agrees('in the grace period');
  assert.equal(shown(), true, 'grace still counts, as it does for the members area');
  w.later(GRACE_MS);
  agrees('after the grace period');
  assert.equal(shown(), false);

  w.billing.opened('again', aina.id, 'checkout', 'month');
  w.billing.paid('again', false);
  agrees('once paid again');
  assert.equal(shown(), true, 'paying again brings it back without a new check');

  w.billing.setRenews(aina.id, false);
  w.later(new Date(w.billing.standing(aina.id).paidUntil ?? 0).getTime() - w.now().getTime() + 60_000);
  agrees('with renewal off, just past the month');
  assert.equal(shown(), false, 'no grace once renewal is off');
});

test('a refund takes the paid time off, and the listing with it once access ends', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  w.listed(aina.id, practice());
  w.billing.reversed(`checkout-${aina.id}`);
  assert.equal(w.listings.listing(aina.id)?.shown, w.billing.access(aina.id) !== 'unpaid');
  w.later(GRACE_MS + 60_000);
  assert.equal(w.billing.access(aina.id), 'unpaid');
  assert.equal(w.listings.listing(aina.id)?.shown, false);
});

test('an admin is shown without paying, and a member who never paid is not', async () => {
  const w = await world();
  w.listed(w.host.id, practice({ practice: 'Johar Partners' }));
  assert.deepEqual(w.inDirectory(), ['Johar Partners']);

  w.club.recordJoinRequest({ name: 'Chen Wei', email: 'chen@firm.com.my', stage: 'I run a practice' });
  const request = w.club.joinRequests({ decided: false })[0];
  assert.ok(request);
  const chen = await w.club.setPasswordFromLink(sentLink(w.club.inviteFromRequest(request.id)).token, PASSWORD);
  assert.ok(chen);
  w.listed(chen.member.id, practice({ practice: 'Chen & Co' }));
  assert.deepEqual(w.inDirectory(), ['Johar Partners']);
});

test('the directory filters by state and service, and a state also finds practices that take clients anywhere', async () => {
  const w = await world();
  const add = async (name: string, content: Partial<ListingContent>) => w.listed((await w.member(name, `${name.split(' ')[0]?.toLowerCase()}@firm.com.my`)).id, practice(content));
  await add('Aina Rahman', { practice: 'Rahman & Co', state: 'Selangor', services: ['bookkeeping'] });
  await add('Bilal Osman', { practice: 'Osman Accounting', state: 'Kuala Lumpur', remote: true, services: ['payroll', 'bookkeeping'] });
  await add('Chen Wei', { practice: 'Chen & Co', state: 'Johor', services: ['bookkeeping'] });
  await add('Devi Nair', { practice: 'apex books', state: 'Selangor', services: ['audit'] });
  const names = (list: readonly { practice: string }[]) => list.map((l) => l.practice);

  const everything = w.listings.directory({});
  assert.equal(everything.total, 4);
  assert.deepEqual(names(everything.matches), ['Chen & Co', 'Osman Accounting', 'apex books', 'Rahman & Co'], 'by state, then practice, ignoring case');
  assert.deepEqual(everything.anywhere, []);

  const selangor = w.listings.directory({ state: 'Selangor' });
  assert.deepEqual(names(selangor.matches), ['apex books', 'Rahman & Co']);
  assert.deepEqual(names(selangor.anywhere), ['Osman Accounting'], 'based in Kuala Lumpur, takes clients anywhere');
  assert.equal(selangor.total, 4);

  assert.deepEqual(names(w.listings.directory({ service: 'payroll' }).matches), ['Osman Accounting']);
  const johorPayroll = w.listings.directory({ state: 'Johor', service: 'payroll' });
  assert.deepEqual(names(johorPayroll.matches), []);
  assert.deepEqual(names(johorPayroll.anywhere), ['Osman Accounting']);
  const kl = w.listings.directory({ state: 'Kuala Lumpur' });
  assert.deepEqual([names(kl.matches), names(kl.anywhere)], [['Osman Accounting'], []], 'a practice in the state is never counted twice');
  const perlisAudit = w.listings.directory({ state: 'Perlis', service: 'audit' });
  assert.deepEqual([names(perlisAudit.matches), names(perlisAudit.anywhere)], [[], []]);

  const summary = (filter: Parameters<typeof w.listings.directory>[0]) => directorySummary(w.listings.directory(filter), filter);
  assert.equal(summary({}), 'Four practices are listed.');
  assert.equal(summary({ state: 'Selangor' }), 'Two practices in Selangor match. One practice based elsewhere takes clients anywhere in Malaysia.');
  assert.equal(summary({ service: 'payroll' }), 'One practice matches.');
  assert.equal(summary({ state: 'Johor', service: 'payroll' }), 'No practices in Johor match. One practice based elsewhere takes clients anywhere in Malaysia.');
  assert.equal(summary({ state: 'Perlis', service: 'audit' }), 'No practices in Perlis match.');
});

test('hosts see what waits for a check first, oldest first, then everything else', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const bilal = await w.member('Bilal Osman', 'bilal@firm.com.my');
  const chen = await w.member('Chen Wei', 'chen@firm.com.my');
  w.listings.save(chen.id, practice({ practice: 'Chen & Co' }));
  w.later(60_000);
  w.listings.save(aina.id, practice({ practice: 'Rahman & Co' }));
  w.later(60_000);
  w.listed(bilal.id, practice({ practice: 'Osman Accounting' }));

  const { waiting, rest } = w.listings.forHosts();
  assert.deepEqual(waiting.map((l) => l.practice), ['Chen & Co', 'Rahman & Co']);
  assert.deepEqual(rest.map((l) => l.practice), ['Osman Accounting']);
  assert.equal(waiting[0]?.email, 'chen@firm.com.my', 'hosts see who to write to');
});

test('the hosts are told about a listing to check, and only the hosts', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const { listing } = w.listings.save(aina.id, practice());
  const letter = listingQueuedLetter(['host@club.test'], listing, 'submitted', 'https://therestisaccountancy.com/admin/listings');
  assert.deepEqual(letter.to, ['host@club.test']);
  const { html, text } = await renderLetter(letter);
  assert.ok(text.includes('Rahman & Co (Petaling Jaya, Selangor)'));
  assert.ok(html.includes('href="https://therestisaccountancy.com/admin/listings"'));
  assert.ok(!text.includes('hello@rahman.example'), 'the typed contact address is not where club mail goes');
});

test('the member hears from the host who listed it, at their own address, with a link to the entry', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const listed = w.listed(aina.id, practice());
  const letter = listingApprovedLetter(listed, w.host, 'https://therestisaccountancy.com');
  assert.equal(letter.to, 'aina@firm.com.my');
  assert.equal(letter.from, 'Hazli from The Rest Is Accountancy');
  const { html } = await renderLetter(letter);
  assert.ok(html.includes(`href="https://therestisaccountancy.com/directory?state=Selangor#listing-${aina.id}"`));
});

test('approving a paused listing tells the member it shows once they unpause, and links to no entry', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const { listing } = w.listings.save(aina.id, practice());
  w.listings.setPaused(aina.id, true);
  const approved = value(w.listings.approve(aina.id, w.host.id, listing.updatedAt));
  const letter = listingApprovedLetter(approved, w.host, 'https://therestisaccountancy.com');
  assert.equal(letter.subject, 'Your directory listing is approved');
  const { html, text } = await renderLetter(letter);
  assert.ok(text.includes('It is paused, so it goes in the directory when you unpause it.'));
  assert.ok(html.includes('href="https://therestisaccountancy.com/members/listing"'));
  assert.ok(!html.includes('/directory?'), 'no link to an entry the public cannot see');
});

test('a returned listing carries the note as plain text', async () => {
  const w = await world();
  const aina = await w.member('Aina Rahman', 'aina@firm.com.my');
  const { listing } = w.listings.save(aina.id, practice());
  const note = 'Your site at https://rahman.example does not load. <b>Check it</b>.';
  const returned = value(w.listings.sendBack(aina.id, listing.updatedAt, note));
  const letter = listingReturnedLetter(returned, note, w.host, 'https://therestisaccountancy.com');
  assert.equal(letter.to, 'aina@firm.com.my');
  const { html, text } = await renderLetter(letter);
  assert.ok(text.includes('https://rahman.example does not load.'));
  assert.ok(!html.includes('href="https://rahman.example'), 'a typed address never becomes a link');
  assert.ok(html.includes('&lt;b&gt;Check it&lt;/b&gt;'));
  assert.ok(html.includes('href="https://therestisaccountancy.com/members/listing"'));
});
