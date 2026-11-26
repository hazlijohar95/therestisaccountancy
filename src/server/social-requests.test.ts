import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY, PASSWORD, reason, socialWorld, value } from './social-fixtures.ts';

const draft = (email = 'siti@firm.my') => ({ name: 'Siti', email, about: 'Audit senior in KL. I post on LinkedIn about MFRS.', link: 'https://www.linkedin.com/in/siti' });

test('a request waits for the team, once per email', () => {
  const w = socialWorld();
  value(w.requests.request(draft()));
  assert.equal(reason(w.requests.request(draft('SITI@firm.my'))), 'pending', 'one waiting request per email, whatever the case');
  value(w.requests.request({ ...draft('abu@firm.my'), link: null }));
  assert.deepEqual(
    w.requests.queue().map((r) => [r.email, r.state, r.link]),
    [
      ['siti@firm.my', 'pending', 'https://www.linkedin.com/in/siti'],
      ['abu@firm.my', 'pending', null],
    ],
  );
});

test('an approved request makes the account, records how it joined, and lets them pick a handle after the password', async () => {
  const w = socialWorld();
  const host = await w.host;
  value(w.requests.request(draft()));
  const id = w.requests.queue()[0]?.id ?? 0;
  const approval = value(w.requests.approve(id, host.id));
  assert.ok(approval.kind === 'welcome');
  const member = w.club.member(approval.memberId);
  assert.equal(member?.joinedVia, 'social');
  assert.equal(member?.clubApproved, false, 'Social does not let anyone into the club');
  assert.deepEqual(w.profiles.entry(approval.memberId), { via: 'request', inviterId: null });
  assert.equal(reason(w.requests.approve(id, host.id)), 'decided');
  assert.equal(reason(w.requests.decline(id, host.id)), 'decided');
  assert.deepEqual(w.requests.queue(), []);

  const accepted = await w.club.setPasswordFromLink(value(w.club.newLink(approval.memberId)).token, PASSWORD);
  assert.ok(accepted);
  assert.equal(w.profiles.mayClaim(approval.memberId), true);
  value(w.profiles.claimHandle(approval.memberId, 'siti'));
  assert.deepEqual(w.profiles.entry(approval.memberId), { via: 'request', inviterId: null });
  assert.equal(w.profiles.profile('siti')?.name, 'Siti');
});

test('approving someone who already signs in tells them so, and a paused account is refused', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  value(w.requests.request(draft('aina@firm.my')));
  const queued = w.requests.queue()[0];
  assert.equal(queued?.onSocial, 'aina', 'the team sees the email is on Social already');
  assert.deepEqual(value(w.requests.approve(queued?.id ?? 0, host.id)), { kind: 'sign-in', name: 'Aina', email: 'aina@firm.my', hasProfile: true });
  assert.deepEqual(w.profiles.entry(aina.id), { via: 'team', inviterId: null }, 'the first way in is kept');

  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  value(w.club.suspendMember(host.id, abu.id));
  value(w.requests.request(draft('abu@firm.my')));
  const paused = w.requests.queue()[0]?.id ?? 0;
  assert.equal(reason(w.requests.approve(paused, host.id)), 'suspended');
  assert.equal(w.requests.queue()[0]?.id, paused, 'a refused approval leaves the request waiting');
});

test('a declined request can ask again, and is deleted after ninety days', async () => {
  const w = socialWorld();
  const host = await w.host;
  value(w.requests.request(draft()));
  assert.deepEqual(value(w.requests.decline(w.requests.queue()[0]?.id ?? 0, host.id)), { name: 'Siti', email: 'siti@firm.my' });
  assert.equal(w.club.members({ limit: 10, offset: 0 }).items.some((m) => m.email === 'siti@firm.my'), false, 'declining makes no account');
  value(w.requests.request(draft()));
  value(w.requests.request(draft('approved@firm.my')));
  value(w.requests.approve(w.requests.queue().find((r) => r.email === 'approved@firm.my')?.id ?? 0, host.id));

  w.later(89 * DAY);
  assert.equal(w.requests.prune(), 0);
  w.later(2 * DAY);
  assert.equal(w.requests.prune(), 1, 'only the old declined one goes');
  assert.equal(w.requests.queue().length, 1, 'the request waiting is kept');
  assert.equal(w.db.prepare(`SELECT count(*) AS n FROM social_requests WHERE state = 'approved'`).get()?.['n'], 1, 'approved ones are kept');
});

test('the schema refuses a request decided without a time, or a link that is not https', () => {
  const w = socialWorld();
  assert.throws(() => w.db.prepare(`INSERT INTO social_requests (name, email, about, state, created_at) VALUES ('A', 'a@b.my', 'x', 'declined', '2026-01-01T00:00:00Z')`).run());
  assert.throws(() => w.db.prepare(`INSERT INTO social_requests (name, email, about, link, created_at) VALUES ('A', 'a@b.my', 'x', 'http://a.my', '2026-01-01T00:00:00Z')`).run());
});

test('approving someone who never set a password gives their new link the full time before the account counts as abandoned', async () => {
  const w = socialWorld();
  const host = await w.host;
  const { memberId } = value(w.profiles.signUp({ name: 'Siti', email: 'siti@firm.my', handle: 'siti' }, { via: 'open' }));
  w.later(13 * DAY);
  value(w.requests.request(draft()));
  const approval = value(w.requests.approve(w.requests.queue()[0]?.id ?? 0, host.id));
  assert.deepEqual(approval, { kind: 'welcome', memberId });
  w.later(2 * DAY);
  assert.equal(w.profiles.pruneAbandoned(), 0, 'the clock started again at approval');
  assert.ok(w.club.member(memberId));
  w.later(13 * DAY);
  assert.equal(w.profiles.pruneAbandoned(), 1, 'and runs out like any other');
});
