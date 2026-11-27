import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Access } from '../../../src/server/billing.ts';
import type { Profile } from '../../../src/server/social-profiles.ts';
import { clubAway, decide, type Lookups, type Who } from './access.ts';

const member: Who = { id: 7, role: 'member' };
const admin: Who = { id: 1, role: 'admin' };
const profile: Profile = { memberId: 7, handle: 'ada', name: 'Ada', track: 'qualified', sealed: false, createdAt: '2026-01-01T00:00:00Z', headline: '', sector: null, city: '', jurisdictions: [], topics: [], creator: false, listed: true };

/** Lookups that answer as told and remember what was asked. */
function lookups(access: Access, own: Profile | null = null) {
  const asked: string[] = [];
  const answers: Lookups = {
    billing: {
      access: () => {
        asked.push('billing');
        return access;
      },
    },
    socialProfiles: {
      ownProfile: () => {
        asked.push('profile');
        return own;
      },
    },
  };
  return { asked, answers };
}

test('a membership in its grace period still reads what membership pays for', async () => {
  assert.deepEqual(await decide('paid', member, lookups('grace').answers), { ok: true, actor: member });
  assert.deepEqual(await decide('paid', member, lookups('unpaid').answers), { ok: false, denial: 'unpaid' });
});

test('an admin never pays, and billing is not asked', async () => {
  const { asked, answers } = lookups('unpaid');
  assert.deepEqual(await decide('paid', admin, answers), { ok: true, actor: admin });
  assert.deepEqual(asked, []);
});

test('a level asks only what it turns on', async () => {
  const { asked, answers } = lookups('paid', profile);
  await decide('anyone', null, answers);
  await decide('member', member, answers);
  await decide('admin', member, answers);
  assert.deepEqual(asked, []);
  assert.deepEqual(await decide('profile', member, answers), { ok: true, actor: profile });
  assert.deepEqual(asked, ['profile']);
});

test('signed out is the first reason at every level but anyone', async () => {
  const { answers } = lookups('paid', profile);
  for (const level of ['member', 'paid', 'profile', 'admin'] as const) assert.deepEqual(await decide(level, null, answers), { ok: false, denial: 'signed-out' }, level);
  assert.deepEqual(await decide('anyone', null, answers), { ok: true, actor: null });
});

test('a club page sends someone signed out to sign in and back to the same page and query', () => {
  assert.equal(clubAway['signed-out']('/admin/fees?edition=2025'), '/sign-in?next=%2Fadmin%2Ffees%3Fedition%3D2025');
  assert.equal(clubAway.unpaid('/members/plan'), '/members/pay');
  assert.equal(clubAway['not-admin']('/admin'), '/members');
});
