import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';
import { judged, type ProblemDraft } from './social-problems.ts';
import { createStore } from './store.ts';

const PASSWORD = 'correct horse battery';
const DAY = 86_400_000;

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);
const at = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const world = () => {
  let clock = new Date('2026-11-26T02:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  const { club, socialProfiles: profiles, socialClaims: claims, socialProblems: problems } = createStore(db, now);
  const host = club.ensureAdmin({ email: 'host@club.test', name: 'Host', password: PASSWORD });

  const joined = async (name: string, email: string, handle: string) => {
    const { memberId } = value(profiles.signUp({ name, email, handle }, { via: 'team' }));
    const accepted = await club.setPasswordFromLink(value(club.newLink(memberId)).token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  /** A proven account and a ticked ACCA membership: the seal. Returns the body claim, to take the seal away again. */
  const seal = async (memberId: number, handle: string) => {
    const reviewer = (await host).id;
    const account = value(claims.addAccount(memberId, 'LinkedIn', handle));
    value(claims.decideAccount(account.id, reviewer, { verdict: 'approve' }));
    const body = value(claims.addClaim(memberId, { kind: 'body', bodyId: 'acca', status: 'Member', reference: '1', otherName: null, evidenceKey: null }));
    value(claims.decideClaim(body.id, reviewer, { verdict: 'approve' }));
    return body;
  };
  /** A problem open from now for a week, unless told otherwise. */
  const draft = (changes: Partial<ProblemDraft> = {}): ProblemDraft => ({
    number: 1,
    tag: 'Audit',
    jurisdiction: 'MY',
    title: 'The stock count nobody attended',
    scenario: ['Year end was 31 December.', 'Nobody from the firm attended the count.'],
    ask: 'What do you do?',
    options: ['Qualify the opinion', 'Do alternative procedures', 'Resign'],
    opensAt: at(clock),
    closesAt: at(new Date(clock.getTime() + 7 * DAY)),
    ...changes,
  });
  return { db, club, profiles, claims, problems, host, joined, seal, draft, later: (ms: number) => (clock = new Date(clock.getTime() + ms)), now };
};

test('the team schedules problems one window at a time, and members see a problem only once it opens', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  value(w.problems.create(host.id, w.draft()));

  assert.equal(reason(w.problems.create(host.id, w.draft())), 'number-taken');
  assert.equal(reason(w.problems.create(host.id, w.draft({ number: 2, opensAt: at(new Date(w.now().getTime() + 3 * DAY)) }))), 'overlaps', 'two open at once');
  assert.equal(reason(w.problems.create(host.id, w.draft({ number: 2, closesAt: w.draft().opensAt }))), 'window');
  const nextWeek = w.now().getTime() + 7 * DAY;
  value(w.problems.create(host.id, w.draft({ number: 2, title: 'Next week', opensAt: at(new Date(nextWeek)), closesAt: at(new Date(nextWeek + 7 * DAY)) })));
  assert.equal(w.problems.nextNumber(), 3);

  assert.equal(w.problems.view(aina.id, null)?.problem.number, 1, 'the open one');
  assert.equal(w.problems.view(aina.id, 2), null, 'a scheduled problem is the team’s until it opens');
  assert.equal(w.problems.view(null, 2), null);
  assert.equal(w.problems.view(host.id, 2)?.problem.state, 'scheduled', 'the team previews it');
  assert.equal(w.problems.nextOpens(), at(new Date(nextWeek)));
  assert.deepEqual(w.problems.archive(), [], 'nothing has closed');
  assert.equal(reason(w.problems.answer(aina.id, 2, { pick: 'A', reasoning: '' })), 'not-found');

  w.later(7 * DAY);
  assert.equal(w.problems.view(aina.id, null)?.problem.number, 2, 'the next one opens as the first closes');
  assert.deepEqual(
    w.problems.archive().map((p) => p.number),
    [1],
  );
});

test('members answer once, with a handle, and only while it is open', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  value(w.problems.create(host.id, w.draft({ options: ['Qualify', 'Alternative procedures'] })));

  assert.equal(reason(w.problems.answer(host.id, 1, { pick: 'A', reasoning: '' })), 'no-handle', 'the host never claimed a handle');
  assert.equal(reason(w.problems.answer(aina.id, 1, { pick: 'C', reasoning: '' })), 'no-option', 'there is no C');
  value(w.problems.answer(aina.id, 1, { pick: 'B', reasoning: 'Count it after year end and roll back.' }));
  assert.equal(reason(w.problems.answer(aina.id, 1, { pick: 'A', reasoning: '' })), 'already');
  assert.deepEqual(w.problems.view(aina.id, 1)?.mine, { pick: 'B', reasoning: 'Count it after year end and roll back.' });

  w.later(7 * DAY);
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  assert.equal(reason(w.problems.answer(priya.id, 1, { pick: 'A', reasoning: '' })), 'not-open');
});

test('answers and the spread stay hidden until you answer or it closes, then show to everyone', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const siti = await w.joined('Siti', 'siti@audit.my', 'siti');
  value(w.problems.create(host.id, w.draft()));
  value(w.problems.answer(aina.id, 1, { pick: 'B', reasoning: 'Alternative procedures.' }));
  value(w.problems.answer(priya.id, 1, { pick: 'B', reasoning: '' }));
  value(w.problems.answer(siti.id, 1, { pick: 'A', reasoning: 'Qualify.' }));

  const before = w.problems.view(null, 1);
  assert.equal(before?.revealed, false);
  assert.deepEqual(before?.answers, []);
  assert.deepEqual(before?.spread, []);
  assert.equal(before?.most, null);
  assert.equal(before?.problem.answers, 3, 'the count shows, the picks do not');

  const after = w.problems.view(aina.id, 1);
  assert.equal(after?.revealed, true);
  assert.deepEqual(
    after?.spread.map((s) => [s.key, s.count, s.percent]),
    [
      ['A', 1, 33],
      ['B', 2, 67],
      ['C', 0, 0],
    ],
  );
  assert.equal(after?.most, 'B');
  assert.equal(after?.answers[0]?.mine, true, 'your own answer first');

  w.later(7 * DAY);
  const closed = w.problems.view(null, 1);
  assert.equal(closed?.revealed, true, 'the archive is open to everyone');
  assert.equal(closed?.answers.length, 3);
  assert.equal(closed?.canRate, false);
});

test('members with the seal rate the answers they can see, never their own, while it is open', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const siti = await w.joined('Siti', 'siti@audit.my', 'siti');
  const body = await w.seal(priya.id, 'priya-nair');
  await w.seal(siti.id, 'siti-aisyah');
  value(w.problems.create(host.id, w.draft()));
  value(w.problems.answer(aina.id, 1, { pick: 'B', reasoning: 'Alternative procedures.' }));
  const ainas = w.problems.view(aina.id, 1)?.answers[0]?.id ?? 0;

  assert.equal(reason(w.problems.rate(priya.id, ainas, 'sound')), 'not-found', 'answer first: until then it is hidden');
  value(w.problems.answer(priya.id, 1, { pick: 'B', reasoning: '' }));
  value(w.problems.answer(siti.id, 1, { pick: 'A', reasoning: '' }));
  const priyas = w.problems.view(priya.id, 1)?.answers.find((a) => a.mine)?.id ?? 0;
  assert.equal(reason(w.problems.rate(aina.id, priyas, 'sound')), 'no-seal');
  assert.equal(reason(w.problems.rate(priya.id, priyas, 'sound')), 'self');
  assert.equal(w.problems.view(priya.id, 1)?.canRate, true);

  value(w.problems.rate(priya.id, ainas, 'partly'));
  assert.deepEqual(value(w.problems.rate(priya.id, ainas, 'sound')).ratings, { sound: 1, partly: 0, unsound: 0 }, 'a new rating replaces the old');
  value(w.problems.rate(siti.id, ainas, 'sound'));
  assert.equal(w.problems.view(priya.id, 1)?.answers.find((a) => a.id === ainas)?.viewerRating, 'sound');
  assert.deepEqual(value(w.problems.rate(siti.id, ainas, null)).ratings, { sound: 1, partly: 0, unsound: 0 }, 'null takes it back');

  assert.ok(w.claims.removeClaim(priya.id, body.id).removed);
  assert.deepEqual(w.problems.view(aina.id, 1)?.answers.find((a) => a.id === ainas)?.ratings, { sound: 0, partly: 0, unsound: 0 }, 'ratings count while their rater holds the seal');

  w.later(7 * DAY);
  assert.equal(reason(w.problems.rate(siti.id, ainas, 'sound')), 'closed');
});

test('the judgment record judges each answer by its most common rating, ties going to the harsher', async () => {
  assert.equal(judged({ sound: 2, partly: 1, unsound: 0 }), 'sound');
  assert.equal(judged({ sound: 1, partly: 0, unsound: 1 }), 'unsound');
  assert.equal(judged({ sound: 1, partly: 1, unsound: 0 }), 'partly');
  assert.equal(judged({ sound: 0, partly: 0, unsound: 0 }), null);

  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  await w.seal(priya.id, 'priya-nair');
  const week = (n: number) => {
    const opens = w.now().getTime();
    value(w.problems.create(host.id, w.draft({ number: n, opensAt: at(new Date(opens)), closesAt: at(new Date(opens + 7 * DAY)) })));
  };
  for (const [n, rating] of [
    [1, 'sound'],
    [2, 'unsound'],
    [3, null],
  ] as const) {
    week(n);
    value(w.problems.answer(aina.id, n, { pick: 'A', reasoning: '' }));
    value(w.problems.answer(priya.id, n, { pick: 'A', reasoning: '' }));
    const theirs = w.problems.view(priya.id, n)?.answers.find((a) => !a.mine)?.id ?? 0;
    if (rating) value(w.problems.rate(priya.id, theirs, rating));
    w.later(7 * DAY);
  }
  assert.deepEqual(w.problems.record(aina.id), { answers: 3, rated: 2, sound: 1, partly: 0, unsound: 1 });
});

test('the streak counts problems answered in a row, and the open one breaks nothing until it closes', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const opens = (n: number) => {
    value(w.problems.create(host.id, w.draft({ number: n, opensAt: at(w.now()), closesAt: at(new Date(w.now().getTime() + 7 * DAY)) })));
  };
  assert.equal(w.problems.streak(aina.id), 0);
  opens(1);
  w.later(7 * DAY);
  opens(2);
  value(w.problems.answer(aina.id, 2, { pick: 'A', reasoning: '' }));
  w.later(7 * DAY);
  opens(3);
  value(w.problems.answer(aina.id, 3, { pick: 'A', reasoning: '' }));
  w.later(7 * DAY);
  opens(4);
  assert.equal(w.problems.streak(aina.id), 2, 'number 1 was missed; number 4 is still open');
  w.later(7 * DAY);
  assert.equal(w.problems.streak(aina.id), 0, 'number 4 closed unanswered');
});

test('peer points on The List are Sound ratings from this quarter', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  const priya = await w.joined('Priya', 'priya@tax.my', 'priya');
  const siti = await w.joined('Siti', 'siti@audit.my', 'siti');
  await w.seal(priya.id, 'priya-nair');
  await w.seal(siti.id, 'siti-aisyah');
  value(w.problems.create(host.id, w.draft()));
  for (const member of [aina, priya, siti]) value(w.problems.answer(member.id, 1, { pick: 'A', reasoning: '' }));
  const answerOf = (memberId: number) => w.problems.view(memberId, 1)?.answers.find((a) => a.mine)?.id ?? 0;
  value(w.problems.rate(priya.id, answerOf(aina.id), 'sound'));
  value(w.problems.rate(siti.id, answerOf(aina.id), 'sound'));
  value(w.problems.rate(priya.id, answerOf(siti.id), 'partly'));

  assert.deepEqual(
    w.profiles.list().map((entry) => [entry.profile.handle, entry.points]),
    [
      ['aina', 2],
      ['priya', 0],
      ['siti', 0],
    ],
  );
  w.later(40 * DAY);
  assert.equal(w.profiles.list()[0]?.points, 0, 'January starts a new quarter in Malaysia');
});

test('the team can take back a problem until someone answers it', async () => {
  const w = world();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  value(w.problems.create(host.id, w.draft()));
  value(w.problems.create(host.id, w.draft({ number: 2, opensAt: at(new Date(w.now().getTime() + 7 * DAY)), closesAt: at(new Date(w.now().getTime() + 14 * DAY)) })));
  value(w.problems.answer(aina.id, 1, { pick: 'A', reasoning: '' }));
  assert.equal(reason(w.problems.remove(1)), 'answered');
  value(w.problems.remove(2));
  assert.equal(reason(w.problems.remove(2)), 'not-found');
});
