import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import type { Member } from '../../../src/server/club.ts';
import type { Letter } from '../../../src/server/letters.ts';
import { openDatabase } from '../../../src/server/node-db.ts';
import { createStore } from '../../../src/server/store.ts';
import { denials } from './access.ts';
import { createAction, tooManyTries } from './action.ts';
import { done, refused } from './outcome.ts';

type TestStore = ReturnType<typeof createStore>;

const clock = new Date('2026-11-26T02:00:00Z');
const member = (role: Member['role'], id = 9_001): Member => ({ id, email: `${role}${id}@club.test`, name: 'Ada', role, status: 'active', joinedAt: '2026-01-01T00:00:00Z', joinedVia: 'club', clubApproved: true });

/** The test side of the seam: a fixed member, node:sqlite, a throttle that answers as told, and letters kept to look at. */
function world(who: Member | null, { allow = true, store = createStore(openDatabase(':memory:'), () => clock) } = {}) {
  const sent: Letter[] = [];
  const throttled: string[] = [];
  const action = createAction<TestStore>({
    member: async () => who,
    open: async (fn) => await fn(store),
    allow: async (_, form) => {
      throttled.push(form);
      return allow;
    },
    send: (letters) => sent.push(...letters),
  });
  return { store, sent, throttled, action };
}

const letter: Letter = { to: 'ada@club.test', subject: 'Hello', lines: [] };
const note = z.object({ text: z.string('Write something.').min(1, 'Write something.') });

test('each level turns away who it should, with the message the form shows', async () => {
  const cases = [
    { access: 'member', who: null, message: denials['signed-out'] },
    { access: 'paid', who: null, message: denials['signed-out'] },
    { access: 'paid', who: member('member'), message: denials.unpaid },
    { access: 'admin', who: member('member'), message: denials['not-admin'] },
    { access: 'profile', who: member('member'), message: denials['no-handle'] },
  ] as const;
  for (const { access, who, message } of cases) {
    const { action } = world(who);
    const outcome = await action({ access, input: note }, async () => done('ran'))({ data: { text: 'hi' } });
    assert.deepEqual(outcome, { ok: false, message, fields: {} }, `${access} with ${who?.role ?? 'nobody'}`);
  }
});

test('anyone acts signed out, a member acts signed in, and an admin acts where membership is paid for', async () => {
  const runs = [
    { access: 'anyone', who: null },
    { access: 'member', who: member('member') },
    { access: 'paid', who: member('admin') },
    { access: 'admin', who: member('admin') },
  ] as const;
  for (const { access, who } of runs) {
    const { action } = world(who);
    const outcome = await action({ access, input: note }, async ({ actor, input }) => done({ actor: actor?.id ?? null, text: input.text }))({ data: { text: 'hi' } });
    assert.deepEqual(outcome, done({ actor: who?.id ?? null, text: 'hi' }), access);
  }
});

test('a member with a handle acts as their profile', async () => {
  const store = createStore(openDatabase(':memory:'), () => clock);
  const { memberId } = signUp(store);
  const { action } = world(member('member', memberId), { store });
  const outcome = await action({ access: 'profile', input: z.undefined() }, async ({ actor }) => done(actor.handle))({ data: undefined });
  assert.deepEqual(outcome, done('ada_lovelace'));
});

test('bad input answers each field’s first problem', async () => {
  const { action } = world(member('member'));
  const outcome = await action({ access: 'member', input: note }, async () => done('ran'))({ data: { text: '' } });
  assert.deepEqual(outcome, refused('Check the fields marked below.', { text: 'Write something.' }));
});

test('someone turned away never sees what was wrong with the fields', async () => {
  const { action } = world(null);
  const outcome = await action({ access: 'member', input: note }, async () => done('ran'))({ data: { text: '' } });
  assert.deepEqual(outcome, refused(denials['signed-out']));
});

test('a post over the limit is refused before the work, and a post with a typo is not counted', async () => {
  const full = world(member('member'), { allow: false });
  let ran = false;
  const work = async () => {
    ran = true;
    return done('ran');
  };
  assert.deepEqual(await full.action({ access: 'member', input: note, limit: 'shelf' }, work)({ data: { text: 'hi' } }), refused(tooManyTries));
  assert.equal(ran, false);
  const open = world(member('member'));
  await open.action({ access: 'member', input: note, limit: 'shelf' }, work)({ data: { text: '' } });
  assert.deepEqual(open.throttled, []);
});

test('a domain refusal becomes the message its table gives', async () => {
  const { action } = world(member('member'));
  const shelf = { 'no-handle': 'Claim your handle first. Your casebook and shelf show on your profile.', url: 'Use a full https link.', full: 'The shelf is full.' };
  const add = action({ access: 'member', input: z.object({ title: z.string(), url: z.string() }), refusals: shelf }, async ({ actor, input, store }) => await store.socialShelf.add(actor.id, { kind: 'Article', ...input }));
  assert.deepEqual(await add({ data: { title: 'Notes', url: 'https://example.com/notes' } }), refused(shelf['no-handle']));
});

test('letters go only when the action succeeds', async () => {
  const failing = world(member('member'));
  await failing.action({ access: 'member', input: note }, async ({ send }) => {
    send([letter]);
    return refused('No.');
  })({ data: { text: 'hi' } });
  assert.deepEqual(failing.sent, []);
  const passing = world(member('member'));
  await passing.action({ access: 'member', input: note }, async ({ send }) => {
    send([letter]);
    return done(null);
  })({ data: { text: 'hi' } });
  assert.deepEqual(passing.sent, [letter]);
});

function signUp(store: TestStore) {
  const signed = store.socialProfiles.signUp({ name: 'Ada Lovelace', email: 'ada@club.test', handle: 'ada_lovelace' }, { via: 'team' });
  assert.ok(signed.ok);
  return signed.value;
}

