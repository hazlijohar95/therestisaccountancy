import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paidAccess, requiredRole, safeNext } from './paths.ts';

test('member and admin areas are guarded, and nothing else is', () => {
  assert.equal(requiredRole('/members'), 'member');
  assert.equal(requiredRole('/members/lessons/pricing/your-floor-rate'), 'member');
  assert.equal(requiredRole('/admin'), 'admin');
  assert.equal(requiredRole('/admin/'), 'admin');
  assert.equal(requiredRole('/administration'), null);
  assert.equal(requiredRole('/membership'), null);
  assert.equal(requiredRole('/'), null);
});

test('a return path never leaves the site', () => {
  assert.equal(safeNext('/members/account'), '/members/account');
  assert.equal(safeNext('https://evil.example'), '/members');
  assert.equal(safeNext('//evil.example'), '/members');
  assert.equal(safeNext('/\\evil.example'), '/members');
  assert.equal(safeNext(null), '/members');
});


test('members-only reading needs a paid or grace membership; admins never pay', () => {
  assert.equal(paidAccess('member', 'paid'), true);
  assert.equal(paidAccess('member', 'grace'), true);
  assert.equal(paidAccess('member', 'unpaid'), false);
  assert.equal(paidAccess('admin', 'unpaid'), true);
});
