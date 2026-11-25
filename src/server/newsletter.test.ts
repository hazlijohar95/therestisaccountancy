import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIRM_DAYS, CONFIRM_RESEND_GAP_MS, createNewsletter } from './newsletter.ts';
import { openDatabase } from './node-db.ts';

const DAY_MS = 86_400_000;

const world = () => {
  let clock = new Date('2026-11-24T10:00:00Z');
  const newsletter = createNewsletter(openDatabase(':memory:'), () => clock);
  return { newsletter, later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

test('a new address gets a link and is not sent the newsletter until it confirms', () => {
  const { newsletter } = world();
  const link = newsletter.subscribe('aina@firm.com.my', 'footer');
  assert.ok(link);
  assert.equal(link.email, 'aina@firm.com.my');
  assert.equal(link.expiresAt, '2026-12-01T10:00:00Z');
  assert.deepEqual(newsletter.readers(), []);

  assert.deepEqual(newsletter.confirm(link.token), { ok: true, value: { email: 'aina@firm.com.my' } });
  assert.deepEqual(newsletter.readers().map((r) => r.email), ['aina@firm.com.my']);
});

test('asking again while pending resends a link at most once every few minutes, and only the newest works', () => {
  const { newsletter, later } = world();
  const first = newsletter.subscribe('aina@firm.com.my', 'footer');
  assert.ok(first);
  assert.equal(newsletter.subscribe('aina@firm.com.my', 'home'), null, 'too soon for another letter');

  later(CONFIRM_RESEND_GAP_MS + 1);
  const second = newsletter.subscribe('Aina@Firm.com.my', 'home');
  assert.ok(second, 'the address is matched without regard to case');
  assert.deepEqual(newsletter.confirm(first.token), { ok: false, reason: 'unknown' }, 'the replaced link stops working');
  assert.equal(newsletter.confirm(second.token).ok, true);
});

test('a confirmed address gets no letter, and confirming twice still succeeds', () => {
  const { newsletter, later } = world();
  const link = newsletter.subscribe('aina@firm.com.my', 'footer');
  assert.ok(link);
  assert.equal(newsletter.confirm(link.token).ok, true);
  later(CONFIRM_RESEND_GAP_MS + 1);
  assert.equal(newsletter.subscribe('aina@firm.com.my', 'home'), null);
  later(CONFIRM_DAYS * DAY_MS);
  assert.equal(newsletter.confirm(link.token).ok, true, 'a second click, even late, lands on the thank-you');
  assert.equal(newsletter.readers().length, 1);
});

test('a link past its window is refused as expired, and an unknown one as unknown', () => {
  const { newsletter, later } = world();
  const link = newsletter.subscribe('aina@firm.com.my', 'footer');
  assert.ok(link);
  later(CONFIRM_DAYS * DAY_MS);
  assert.deepEqual(newsletter.confirm(link.token), { ok: false, reason: 'expired' });
  assert.deepEqual(newsletter.confirm('not-a-token'), { ok: false, reason: 'unknown' });
  assert.deepEqual(newsletter.readers(), []);
});

test('unsubscribing takes the address off the list, retires its link, and a new sign-up starts over', () => {
  const { newsletter, later } = world();
  const link = newsletter.subscribe('aina@firm.com.my', 'footer');
  assert.ok(link);
  newsletter.confirm(link.token);
  const [reader] = newsletter.readers();
  assert.ok(reader);

  assert.equal(newsletter.unsubscribe(reader.key), true);
  assert.equal(newsletter.unsubscribe(reader.key), true, 'a second click is harmless');
  assert.equal(newsletter.unsubscribe('nobody'), false);
  assert.deepEqual(newsletter.readers(), []);
  assert.deepEqual(newsletter.confirm(link.token), { ok: false, reason: 'unknown' }, 'the old link cannot put them back');

  later(1000);
  const again = newsletter.subscribe('aina@firm.com.my', 'newsletter');
  assert.ok(again, 'an unsubscribed address can sign up again straight away');
  assert.deepEqual(newsletter.readers(), [], 'and is pending until it confirms');
  newsletter.confirm(again.token);
  assert.deepEqual(newsletter.readers(), [reader], 'with the same unsubscribe key');
});
