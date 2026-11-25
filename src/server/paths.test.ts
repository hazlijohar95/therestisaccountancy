import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiredRole, safeNext } from './paths.ts';

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

