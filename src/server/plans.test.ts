import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAN_ANSWER_MAX, planSections } from '../data/plan.ts';
import { renderLetter } from '../emails/render.tsx';
import { createClub } from './club.ts';
import { openDatabase } from './node-db.ts';
import { createPlans, missingSections, planAnsweredLetter, planSentLetter, type SentPlan } from './plans.ts';
import type { Result } from './result.ts';

const SITE = 'https://therestisaccountancy.com/';

const PASSWORD = 'correct horse battery';
const HOUR = 3_600_000;

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

/** Every section written, the way the form posts it. */
const complete: Record<string, string> = Object.fromEntries(planSections.map(({ slug, heading }) => [slug, `${heading}, written down.`]));

/** A host, two members and a clock the test can move. */
const setup = async () => {
  const clock = { now: new Date('2026-11-25T01:00:00Z') };
  const db = openDatabase(':memory:');
  const club = createClub(db, () => clock.now);
  const plans = createPlans(db, () => clock.now);
  const host = await club.ensureAdmin({ email: 'hazli@club.test', name: 'Hazli Johar', password: PASSWORD });
  const member = async (email: string, name: string) => {
    const made = await club.ensureAdmin({ email, name, password: PASSWORD });
    return value(club.updateMember(host.id, made.id, { name, email, role: 'member' }, SITE)).member;
  };
  const aina = await member('aina@firm.com.my', 'Aina Rahman');
  const abu = await member('abu@firm.com.my', 'Abu Musa');
  const later = (hours: number) => {
    clock.now = new Date(clock.now.getTime() + hours * HOUR);
  };
  /** Sends the member's plan and returns it as the hosts read it. */
  const sendAll = (memberId: number, answers: Record<string, string> = complete): SentPlan => {
    value(plans.send(memberId, answers));
    return plans.sent().find((p) => p.member.id === memberId) ?? assert.fail(`member ${memberId}'s plan was not sent`);
  };
  return { db, club, plans, host, aina, abu, later, sendAll };
};

test('a draft keeps what is written so far: the plan’s own sections, tidied and capped', async () => {
  const { plans, aina } = await setup();
  const draft = value(
    plans.save(aina.id, {
      destination: '  Six clients on retainer.\r\n\r\n\r\nTwo staff.  ',
      today: '   ',
      gaps: 'x'.repeat(PLAN_ANSWER_MAX + 50),
      favourite: 'not a section',
    }),
  );
  assert.equal(draft.status, 'draft');
  assert.deepEqual(draft.answers, { destination: 'Six clients on retainer.\n\nTwo staff.', gaps: 'x'.repeat(PLAN_ANSWER_MAX) });
  assert.deepEqual(missingSections(draft.answers), ['today', 'year', 'first', 'question']);

  const again = value(plans.save(aina.id, { destination: 'Eight clients.' }));
  assert.equal(again.id, draft.id, 'saving again changes the same draft');
  assert.deepEqual(again.answers, { destination: 'Eight clients.' }, 'the saved form replaces the draft, blanks included');
  assert.deepEqual(plans.ofMember(aina.id), { open: again, answered: [] });
});

test('a plan goes to the hosts only with every section written, and a short one is kept as a draft', async () => {
  const { plans, aina } = await setup();
  const short = value(plans.send(aina.id, { ...complete, question: '' }));
  assert.equal(short.plan.status, 'draft');
  assert.equal(short.changed, false);
  assert.deepEqual(missingSections(short.plan.answers), ['question']);
  assert.equal(plans.ofMember(aina.id).open?.answers.destination, complete['destination'], 'what was written is saved');
  assert.deepEqual(plans.sent(), [], 'the hosts see nothing yet');

  const sent = value(plans.send(aina.id, complete));
  assert.equal(sent.plan.status, 'sent');
  assert.equal(sent.changed, true);
  assert.equal(sent.plan.id, short.plan.id, 'the same plan, not a second one');
  assert.deepEqual(plans.sent().map((p) => p.id), [sent.plan.id]);
  assert.equal(value(plans.send(aina.id, complete)).changed, false, 'sending it twice tells the hosts once');
});

test('a plan with the hosts changes only once it is taken back', async () => {
  const { plans, aina } = await setup();
  value(plans.send(aina.id, complete));
  const changed = { ...complete, destination: 'A different firm.' };
  assert.equal(reason(plans.save(aina.id, changed)), 'sent');
  assert.equal(reason(plans.send(aina.id, changed)), 'sent', 'other answers from an old page are refused, not dropped');
  assert.equal(plans.ofMember(aina.id).open?.answers.destination, complete['destination']);

  const back = value(plans.takeBack(aina.id));
  assert.equal(back.status, 'draft');
  assert.equal(value(plans.takeBack(aina.id)).id, back.id, 'taking it back twice is harmless');
  assert.deepEqual(plans.sent(), [], 'it leaves the hosts’ list');
  assert.equal(value(plans.save(aina.id, changed)).answers.destination, 'A different firm.');
});

test('hosts see the longest-waiting plan first, and an answer closes it', async () => {
  const { plans, host, aina, abu, later, sendAll } = await setup();
  value(plans.save(abu.id, { destination: 'Still writing.' }));
  const ainas = sendAll(aina.id);
  later(5);
  sendAll(abu.id);
  assert.deepEqual(plans.sent().map((p) => p.member.name), ['Aina Rahman', 'Abu Musa']);

  later(1);
  const answered = value(plans.reply(host.id, ainas, 'Start with pricing.'));
  assert.equal(answered.status, 'answered');
  assert.deepEqual(answered.reply, { text: 'Start with pricing.', by: 'Hazli Johar', at: '2026-11-25T07:00:00Z' });
  assert.equal(answered.sentAt, '2026-11-25T01:00:00Z');
  assert.deepEqual(plans.sent().map((p) => p.member.name), ['Abu Musa']);
  assert.deepEqual(plans.answered(10).map((p) => p.id), [answered.id]);
  assert.deepEqual(plans.ofMember(aina.id), { open: null, answered: [answered] });

  assert.equal(reason(plans.takeBack(aina.id)), 'answered', 'too late to take it back');
  assert.equal(reason(plans.reply(host.id, answered, 'A second answer.')), 'answered', 'one answer per plan');
  assert.deepEqual(plans.ofMember(aina.id).answered, [answered], 'the answer stands as first written');
});

test('a host can answer only a plan that is with the hosts', async () => {
  const { plans, host, aina } = await setup();
  const draft = value(plans.save(aina.id, complete));
  assert.equal(reason(plans.reply(host.id, { id: draft.id, sentAt: '' }, 'Too soon.')), 'not-sent');
  value(plans.send(aina.id, complete));
  value(plans.takeBack(aina.id));
  assert.equal(reason(plans.reply(host.id, { id: draft.id, sentAt: '' }, 'Taken back.')), 'not-sent');
  assert.equal(reason(plans.reply(host.id, { id: 9999, sentAt: '' }, 'Nobody.')), 'not-found');
});

test('an answer to a plan sent again since the host read it is refused', async () => {
  const { plans, host, aina, later, sendAll } = await setup();
  const read = sendAll(aina.id);
  later(1);
  value(plans.takeBack(aina.id));
  const resent = sendAll(aina.id, { ...complete, destination: 'A different firm.' });
  assert.equal(resent.id, read.id, 'the same plan, sent again');
  assert.equal(reason(plans.reply(host.id, read, 'An answer to the old text.')), 'changed');
  assert.deepEqual(plans.sent(), [resent], 'it still waits, with the new text');
  assert.equal(value(plans.reply(host.id, resent, 'An answer to the new text.')).reply.text, 'An answer to the new text.');
});

test('a member sees only their own plans', async () => {
  const { plans, aina, abu } = await setup();
  const sent = value(plans.send(aina.id, complete)).plan;
  assert.equal(plans.ofMember(aina.id).open?.id, sent.id);
  assert.deepEqual(plans.ofMember(abu.id), { open: null, answered: [] });
});

test('the next plan starts from the answered one, with the question blank', async () => {
  const { plans, host, aina, abu, sendAll } = await setup();
  const first = sendAll(aina.id);
  value(plans.reply(host.id, first, 'Good plan.'));

  const next = plans.startNext(aina.id);
  assert.equal(next.status, 'draft');
  assert.notEqual(next.id, first.id);
  const { question, ...carried } = complete;
  assert.ok(question);
  assert.deepEqual(next.answers, carried);
  assert.equal(plans.startNext(aina.id).id, next.id, 'a second click opens nothing new');
  assert.deepEqual(plans.ofMember(aina.id).answered.map((p) => p.id), [first.id], 'the answered plan stays as it was');
  assert.deepEqual(plans.startNext(abu.id).answers, {}, 'a first plan starts blank');
});

test('the database holds each member to one open plan', async () => {
  const { db, plans, aina } = await setup();
  value(plans.save(aina.id, {}));
  assert.throws(() => db.prepare(`INSERT INTO plans (member_id, created_at, updated_at) VALUES (?, 'now', 'now')`).run(aina.id), /UNIQUE/);
});

test('an answer outlives its host, and a removed member takes their plans with them', async () => {
  const { club, plans, host, aina, abu, sendAll } = await setup();
  const other = await club.ensureAdmin({ email: 'abu.host@club.test', name: 'Second Host', password: PASSWORD });
  value(plans.reply(host.id, sendAll(aina.id), 'Hire later.'));
  sendAll(abu.id);

  value(club.removeMember(other.id, host.id, SITE));
  assert.equal(plans.ofMember(aina.id).answered[0]?.reply.by, null);

  value(club.removeMember(other.id, aina.id, SITE));
  value(club.removeMember(other.id, abu.id, SITE));
  assert.deepEqual(plans.answered(10), []);
  assert.deepEqual(plans.sent(), []);
});

test('the admins hear a plan has come in, with its question and a link to answer it', async () => {
  const { aina, sendAll } = await setup();
  const plan = sendAll(aina.id, { ...complete, question: 'Should I hire first?\n\nOr raise fees?' });
  const letter = planSentLetter(['hazli@club.test'], plan, 'https://therestisaccountancy.com/admin/plans#plan-1');
  assert.deepEqual(letter.to, ['hazli@club.test'], 'never the member');
  assert.equal(letter.subject, 'Aina Rahman sent their plan');
  const { html, text } = await renderLetter(letter);
  assert.ok(text.includes('Should I hire first?'));
  assert.ok(text.includes('Or raise fees?'));
  assert.ok(html.includes('href="https://therestisaccountancy.com/admin/plans#plan-1"'));
});

test('the member hears from the host who answered, with a link to read it', async () => {
  const { plans, host, aina, sendAll } = await setup();
  const answered = value(plans.reply(host.id, sendAll(aina.id), 'Start with pricing.'));
  const letter = planAnsweredLetter(answered, host, 'https://therestisaccountancy.com/members/plan/1');
  assert.equal(letter.to, 'aina@firm.com.my');
  assert.equal(letter.from, 'Hazli from The Rest Is Accountancy');
  assert.equal(letter.subject, 'Hazli answered your plan');
  const { html, text } = await renderLetter(letter);
  assert.ok(html.includes('href="https://therestisaccountancy.com/members/plan/1"'));
  assert.ok(text.includes('Hi Aina,'));
});

test('plans waiting count as the hosts list them, each since it was last sent', async () => {
  const { plans, host, aina, abu, later, sendAll } = await setup();
  value(plans.save(abu.id, { destination: 'Still writing.' }));
  assert.deepEqual(plans.waiting(), { count: 0, since: null }, 'a draft is not with the hosts');

  sendAll(aina.id);
  later(5);
  const abus = sendAll(abu.id);
  assert.deepEqual(plans.waiting(), { count: 2, since: '2026-11-25T01:00:00Z' });

  later(1);
  value(plans.takeBack(aina.id));
  later(1);
  sendAll(aina.id);
  assert.deepEqual(plans.waiting(), { count: 2, since: '2026-11-25T06:00:00Z' }, 'sending it again starts her wait over');

  value(plans.reply(host.id, abus, 'Start with pricing.'));
  assert.deepEqual(plans.waiting(), { count: 1, since: '2026-11-25T08:00:00Z' }, 'an answered plan leaves the count');
});
