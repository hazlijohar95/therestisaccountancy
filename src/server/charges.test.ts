import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Term } from '../data/membership.ts';
import { createBilling } from './billing.ts';
import { checkout, renew, settle, type Gateway } from './charges.ts';
import { ChipRefusal, type Purchase } from './chip.ts';
import { createClub } from './club.ts';
import { migrate } from './db.ts';
import { openDatabase } from './node-db.ts';
import { createStore } from './store.ts';

const DAY = 86_400_000;
const SITE = 'https://club.test';

/** CHIP as the flows see it: purchases it was asked for, charges it was asked to make, and what it then says of each. */
const fakeChip = (cards: readonly string[]) => {
  const purchases = new Map<string, Purchase>();
  const asked: { id: string; product: string; amount: number; saving: boolean }[] = [];
  const charged: string[] = [];
  let answer: (id: string) => Purchase = (id) => ({ id, status: 'paid' });
  const gateway: Gateway = {
    async savableMethods() {
      return [...cards];
    },
    async purchase(input) {
      const purchase = { id: `c${asked.length + 1}`, status: 'created', checkout_url: `https://chip.test/p/${asked.length + 1}` };
      purchases.set(purchase.id, purchase);
      asked.push({ id: purchase.id, product: input.product, amount: input.amount, saving: Boolean(input.saveWith?.length) });
      return purchase;
    },
    async charge(id) {
      charged.push(id);
      const result = answer(id);
      purchases.set(id, result);
      return result;
    },
    async get(id) {
      const purchase = purchases.get(id);
      if (!purchase) throw new ChipRefusal(404, []);
      return purchase;
    },
  };
  return {
    gateway,
    asked,
    charged,
    /** The member pays on CHIP's page. */
    pays: (id: string) => purchases.set(id, { id, status: 'paid', is_recurring_token: cards.length > 0 }),
    /** How CHIP answers the next charges. */
    answers: (next: (id: string) => Purchase) => (answer = next),
    /** CHIP takes the money, but the answer never arrives. */
    chargesThenTimesOut: () =>
      (answer = (id) => {
        purchases.set(id, { id, status: 'paid' });
        throw new Error('timed out');
      }),
  };
};

const world = async (cards: readonly string[] = ['visa']) => {
  let clock = new Date('2026-01-31T10:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  migrate(db);
  const club = createClub(db, now);
  club.recordJoinRequest({ name: 'Aina', email: 'aina@firm.com.my', stage: 'I run a practice' });
  const invited = club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0);
  assert.ok(invited.ok && invited.value.kind === 'link');
  const accepted = await club.setPasswordFromLink(invited.value.link.token, 'correct horse battery');
  assert.ok(accepted);
  const billing = createBilling(db, now);
  const chip = fakeChip(cards);
  const member = accepted.member;
  /** Opens a checkout for the term, pays it on CHIP's page, and lets the callback land. */
  const join = async (term: Term) => {
    await checkout(chip.gateway, billing, member, term, SITE);
    const id = chip.asked.at(-1)?.id ?? '';
    chip.pays(id);
    await settle(chip.gateway, billing, id);
    return id;
  };
  return { billing, chip, member, join, later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

test('a checkout asks CHIP for the price of the term chosen, and a paid one adds that term', async () => {
  const w = await world();
  assert.deepEqual(await checkout(w.chip.gateway, w.billing, w.member, 'year', SITE), { ok: true, value: 'https://chip.test/p/1' });
  assert.deepEqual(w.chip.asked, [{ id: 'c1', product: 'The Rest Is Accountancy membership, one year', amount: 99000, saving: true }]);
  assert.equal(await settle(w.chip.gateway, w.billing, 'c1'), null, 'opened is not paid');
  assert.equal(w.billing.access(w.member.id), 'unpaid');

  w.chip.pays('c1');
  const paid = await settle(w.chip.gateway, w.billing, 'c1');
  assert.equal(paid?.standing.paidUntil, '2027-01-31T10:00:00Z');
  assert.equal(paid?.standing.cardOnFile, true);

  await checkout(w.chip.gateway, w.billing, w.member, 'month', SITE);
  assert.deepEqual(w.chip.asked[1], { id: 'c2', product: 'The Rest Is Accountancy membership, one month', amount: 9900, saving: true });
});

test('a repeated callback for a yearly payment changes nothing', async () => {
  const w = await world();
  const id = await w.join('year');
  const before = w.billing.standing(w.member.id);
  assert.equal(await settle(w.chip.gateway, w.billing, id), null);
  assert.equal(await settle(w.chip.gateway, w.billing, id), null);
  assert.deepEqual(w.billing.standing(w.member.id), before);
});

test('a yearly member is renewed with one charge of a year’s price', async () => {
  const w = await world();
  const token = await w.join('year');
  w.later(365 * DAY - 3_600_000);
  const [due] = w.billing.dueRenewals();
  assert.ok(due);

  assert.equal(await renew(w.chip.gateway, w.billing, due, SITE), 'paid');
  assert.deepEqual(w.chip.asked.slice(1), [{ id: 'c2', product: 'The Rest Is Accountancy membership, one year', amount: 99000, saving: false }]);
  assert.deepEqual(w.chip.charged, ['c2']);
  assert.equal(due.token, token);
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2028-01-31T10:00:00Z');
  assert.deepEqual(w.billing.dueRenewals(), []);
});

test('a monthly member is renewed at a month’s price', async () => {
  const w = await world();
  await w.join('month');
  w.later(28 * DAY - 3_600_000);
  const [due] = w.billing.dueRenewals();
  assert.ok(due);
  assert.equal(await renew(w.chip.gateway, w.billing, due, SITE), 'paid');
  assert.deepEqual(w.chip.asked[1], { id: 'c2', product: 'The Rest Is Accountancy membership, one month', amount: 9900, saving: false });
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2026-03-28T10:00:00Z');
});

test('a renewal CHIP charged without answering is counted on the next run, never charged again', async () => {
  const w = await world();
  await w.join('year');
  w.later(365 * DAY - 3_600_000);
  const [first] = w.billing.dueRenewals();
  assert.ok(first);
  w.chip.chargesThenTimesOut();
  await assert.rejects(renew(w.chip.gateway, w.billing, first, SITE), /timed out/);
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2027-01-31T10:00:00Z', 'nothing is counted on a guess');
  assert.deepEqual(w.billing.dueRenewals(), [], 'and it is not tried again within the hour');

  w.later(21 * 3_600_000);
  const [again] = w.billing.dueRenewals();
  assert.ok(again);
  assert.equal(await renew(w.chip.gateway, w.billing, again, SITE), 'paid');
  assert.equal(w.chip.asked.length, 2, 'no second purchase');
  assert.deepEqual(w.chip.charged, ['c2'], 'no second charge');
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2028-02-01T06:00:00Z', 'one year added, once, from when it was counted');

  assert.equal(await settle(w.chip.gateway, w.billing, 'c2'), null, 'the late callback changes nothing');
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2028-02-01T06:00:00Z');
});

test('a declined renewal adds nothing and keeps the card; a refused card is dropped', async () => {
  const w = await world();
  await w.join('year');
  w.later(365 * DAY - 3_600_000);
  const [due] = w.billing.dueRenewals();
  assert.ok(due);
  w.chip.answers((id) => ({ id, status: 'error' }));
  assert.equal(await renew(w.chip.gateway, w.billing, due, SITE), 'declined');
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2027-01-31T10:00:00Z');
  assert.equal(w.billing.standing(w.member.id).cardOnFile, true);

  w.chip.answers(() => {
    throw new ChipRefusal(400, ['invalid_recurring_token']);
  });
  assert.equal(await renew(w.chip.gateway, w.billing, due, SITE), 'card-refused');
  assert.equal(w.billing.standing(w.member.id).cardOnFile, false);
});

test('without cards on the brand nothing is saved, and nothing is ever charged', async () => {
  const w = await world([]);
  await w.join('year');
  assert.equal(w.chip.asked[0]?.saving, false);
  assert.equal(w.billing.standing(w.member.id).cardOnFile, false);
  w.later(365 * DAY);
  assert.deepEqual(w.billing.dueRenewals(), []);
  assert.deepEqual(w.chip.charged, []);
});

/** Someone who signed up on the free social site and set a password, as the social site leaves them. */
const fromSocial = async (email = 'priya@tax.my') => {
  const clock = () => new Date('2026-01-31T10:00:00Z');
  const db = openDatabase(':memory:');
  const { club, socialProfiles, billing } = createStore(db, clock);
  const signed = socialProfiles.signUp({ name: 'Priya Nair', email, handle: 'priyataxes' }, { via: 'team' });
  assert.ok(signed.ok);
  const link = club.newLink(signed.value.memberId);
  assert.ok(link.ok);
  const accepted = await club.setPasswordFromLink(link.value.token, 'correct horse battery');
  assert.ok(accepted);
  return { db, club, chip: fakeChip(['visa']), billing, member: accepted.member };
};

test('someone from the social site cannot pay for the club, and CHIP is never asked', async () => {
  const w = await fromSocial();
  assert.equal(w.member.clubApproved, false);
  assert.deepEqual(await checkout(w.chip.gateway, w.billing, w.member, 'month', SITE), { ok: false, reason: 'not-approved' });
  assert.deepEqual(w.chip.asked, []);
});

test('accepting their join request approves the account they have, with no new member and no password link', async () => {
  const w = await fromSocial();
  w.club.recordJoinRequest({ name: 'Priya N', email: 'PRIYA@tax.my', stage: 'I work in a firm' });
  const invited = w.club.inviteFromRequest(w.club.joinRequests()[0]?.id ?? 0);
  assert.ok(invited.ok && invited.value.kind === 'approved', 'approved, not sent a reset link');
  assert.equal(invited.value.member.id, w.member.id);
  assert.equal(invited.value.member.clubApproved, true);
  assert.equal(invited.value.member.name, 'Priya Nair', 'a member with a password keeps their name');
  assert.equal(w.club.members({ limit: 10, offset: 0 }).total, 1, 'no second member');
  assert.equal(w.club.joinRequests()[0]?.status, 'invited');

  const approved = w.club.member(w.member.id);
  assert.ok(approved);
  const opened = await checkout(w.chip.gateway, w.billing, approved, 'month', SITE);
  assert.equal(opened.ok, true);
});

test('a social sign-up who never set a password is approved and gets the welcome link', async () => {
  const clock = () => new Date('2026-01-31T10:00:00Z');
  const db = openDatabase(':memory:');
  const { club, socialProfiles } = createStore(db, clock);
  const signed = socialProfiles.signUp({ name: 'Dan Tan', email: 'dan@firm.my', handle: 'dantan' }, { via: 'team' });
  assert.ok(signed.ok);
  club.recordJoinRequest({ name: 'Dan Tan', email: 'dan@firm.my', stage: 'I run a practice' });
  const invited = club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0);
  assert.ok(invited.ok && invited.value.kind === 'link');
  assert.equal(invited.value.link.purpose, 'welcome');
  assert.equal(invited.value.link.member.clubApproved, true);
});

test('club members are unaffected: approved from the start, and their checkout opens as before', async () => {
  const w = await world();
  assert.equal(w.member.joinedVia, 'club');
  assert.equal(w.member.clubApproved, true);
  const opened = await checkout(w.chip.gateway, w.billing, w.member, 'year', SITE);
  assert.deepEqual(opened, { ok: true, value: 'https://chip.test/p/1' });
});
