import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY, PASSWORD, reason, SITE, socialWorld, value } from './social-fixtures.ts';

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
  const [letter] = value(w.requests.approve(id, host.id, SITE));
  const member = w.club.members({ query: 'siti@firm.my', limit: 1, offset: 0 }).items[0];
  assert.ok(member);
  assert.equal(member.joinedVia, 'social');
  assert.equal(member.clubApproved, false, 'Social does not let anyone into the club');
  assert.deepEqual(w.profiles.entry(member.id), { via: 'request', inviterId: null });
  assert.equal(reason(w.requests.approve(id, host.id, SITE)), 'decided');
  assert.equal(reason(w.requests.decline(id, host.id)), 'decided');
  assert.deepEqual(w.requests.queue(), []);

  const setPassword = letter?.lines.find((line) => typeof line === 'object');
  assert.ok(typeof setPassword === 'object' && 'href' in setPassword);
  const accepted = await w.club.setPasswordFromLink(new URL(setPassword.href).searchParams.get('token') ?? '', PASSWORD);
  assert.ok(accepted);
  assert.equal(w.profiles.mayClaim(member.id), true);
  value(w.profiles.claimHandle(member.id, 'siti'));
  assert.deepEqual(w.profiles.entry(member.id), { via: 'request', inviterId: null });
  assert.equal(w.profiles.profile('siti')?.name, 'Siti');
});

test('approving someone who already signs in tells them so, and a paused account is refused', async () => {
  const w = socialWorld();
  const host = await w.host;
  const aina = await w.joined('Aina', 'aina@firm.my', 'aina');
  value(w.requests.request(draft('aina@firm.my')));
  const queued = w.requests.queue()[0];
  assert.equal(queued?.onSocial, 'aina', 'the team sees the email is on Social already');
  assert.deepEqual(
    value(w.requests.approve(queued?.id ?? 0, host.id, SITE)).map((l) => [l.to, l.lines[2]]),
    [['aina@firm.my', 'You already sign in here, so there is nothing new to set up.']],
  );
  assert.deepEqual(w.profiles.entry(aina.id), { via: 'team', inviterId: null }, 'the first way in is kept');

  const abu = await w.joined('Abu', 'abu@firm.my', 'abu');
  value(w.club.suspendMember(host.id, abu.id, SITE));
  value(w.requests.request(draft('abu@firm.my')));
  const paused = w.requests.queue()[0]?.id ?? 0;
  assert.equal(reason(w.requests.approve(paused, host.id, SITE)), 'suspended');
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
  value(w.requests.approve(w.requests.queue().find((r) => r.email === 'approved@firm.my')?.id ?? 0, host.id, SITE));

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
  const [letter] = value(w.requests.approve(w.requests.queue()[0]?.id ?? 0, host.id, SITE));
  assert.equal(letter?.to, 'siti@firm.my', 'the account they never finished gets the new link');
  w.later(2 * DAY);
  assert.equal(w.profiles.pruneAbandoned(), 0, 'the clock started again at approval');
  assert.ok(w.club.member(memberId));
  w.later(13 * DAY);
  assert.equal(w.profiles.pruneAbandoned(), 1, 'and runs out like any other');
});


test('approval writes to the account by its own name, with a link that sets the password', async () => {
  const w = socialWorld();
  const host = await w.host;
  value(w.profiles.signUp({ name: 'Nur Siti', email: 'siti@firm.my', handle: 'nursiti' }, { via: 'open' }));
  value(w.requests.request(draft()));
  const [letter, ...rest] = value(w.requests.approve(w.requests.queue()[0]?.id ?? 0, host.id, SITE));
  assert.deepEqual(rest, []);
  assert.equal(letter?.to, 'siti@firm.my');
  assert.equal(letter?.subject, "You're in: The Rest Is Accountancy Social");
  const [greeting, read, setPassword, expiry, free] = letter?.lines ?? [];
  assert.equal(greeting, 'Hi Nur,', 'the account keeps its name; the request does not rename it');
  assert.equal(read, 'We read your request to join, and you are in.');
  assert.equal(expiry, 'Then pick your handle. The link works once and runs out on 10 Dec 2026. If it does, ask for a new one on the sign-in page.');
  assert.equal(free, 'Social is free. There is nothing to pay.');
  assert.ok(typeof setPassword === 'object' && 'href' in setPassword && setPassword.label === 'Set your password');
  const link = new URL(setPassword.href);
  assert.equal(`${link.origin}${link.pathname}`, 'https://therestisaccountancy.com/welcome');
  const accepted = await w.club.setPasswordFromLink(link.searchParams.get('token') ?? '', PASSWORD);
  assert.equal(accepted?.purpose, 'welcome');
  assert.equal(accepted?.member.email, 'siti@firm.my');
});

test('approval tells someone who signs in already to sign in, and sends no link', async () => {
  const w = socialWorld();
  const host = await w.host;
  await w.joined('Aina Rahman', 'aina@firm.my', 'aina');
  value(w.requests.request(draft('aina@firm.my')));
  const letters = value(w.requests.approve(w.requests.queue()[0]?.id ?? 0, host.id, SITE));
  assert.deepEqual(letters, [
    {
      to: 'aina@firm.my',
      subject: "You're in: The Rest Is Accountancy Social",
      lines: [
        'Hi Aina,',
        'We read your request to join, and you are in.',
        'You already sign in here, so there is nothing new to set up.',
        { href: 'https://therestisaccountancy.com/sign-in?next=https%3A%2F%2Fsocial.therestisaccountancy.com%2Fme', label: 'Sign in' },
        'Social is free. There is nothing to pay.',
      ],
    },
  ]);
  assert.equal(w.db.prepare(`SELECT count(*) AS n FROM invites WHERE used_at IS NULL`).get()?.['n'], 0, 'no password link is left open');
});

test('requests waiting count as the team’s queue lists them, since the oldest came in', async () => {
  const w = socialWorld();
  const team = (await w.host).id;
  assert.deepEqual(w.requests.waiting(), { count: 0, since: null });
  value(w.requests.request(draft()));
  w.later(DAY);
  value(w.requests.request(draft('abu@firm.my')));
  assert.deepEqual(w.requests.waiting(), { count: 2, since: '2026-11-26T02:00:00Z' });

  const siti = w.requests.queue()[0];
  assert.ok(siti);
  value(w.requests.decline(siti.id, team));
  assert.deepEqual(w.requests.waiting(), { count: 1, since: '2026-11-27T02:00:00Z' }, 'a declined request leaves the count');
});
