import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressed, clubPath, isSocialPage, paidAccess, requiredRole, safeNext, signInPath, socialHere, socialPath, socialPathOf, socialRoute, socialUrl } from './paths.ts';

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

test('a return address may be on the social host, and nowhere else', () => {
  assert.equal(safeNext('https://social.therestisaccountancy.com/@aina'), 'https://social.therestisaccountancy.com/@aina');
  assert.equal(safeNext('http://social.localhost:4174/edit'), 'http://social.localhost:4174/edit');
  assert.equal(safeNext('http://social.therestisaccountancy.com/'), '/members', 'plain http off localhost');
  assert.equal(safeNext('https://social.therestisaccountancy.com.evil.example/'), '/members');
  assert.equal(safeNext('https://social.therestisaccountancy.com@evil.example/'), '/members');
  assert.equal(safeNext('https://user:pass@social.therestisaccountancy.com/'), '/members');
  assert.equal(safeNext('https://therestisaccountancy.com/members'), '/members', 'the club host is reached by path, not address');
  assert.equal(safeNext('javascript:alert(1)'), '/members');
});

test('a return address may be on the CPE host, and no lookalike of it', () => {
  assert.equal(safeNext('https://cpe.therestisaccountancy.com/course/five-threats'), 'https://cpe.therestisaccountancy.com/course/five-threats');
  assert.equal(safeNext('http://cpe.localhost:5180/home'), 'http://cpe.localhost:5180/home');
  assert.equal(safeNext('http://cpe.therestisaccountancy.com/'), '/members', 'plain http off localhost');
  assert.equal(safeNext('https://cpe.therestisaccountancy.com.evil.example/'), '/members');
  assert.equal(safeNext('https://cpe.therestisaccountancy.com@evil.example/'), '/members');
  assert.equal(safeNext('https://user:pass@cpe.therestisaccountancy.com/'), '/members');
  assert.equal(safeNext('https://evilcpe.therestisaccountancy.com/'), '/members');
  assert.equal(safeNext('https://cpe.evil.example/'), '/members');
});

test('the social host serves the pages under /social, and leaves files and Astro endpoints alone', () => {
  const route = (address: string) => socialRoute(new URL(address))?.href ?? null;
  assert.equal(route('https://social.therestisaccountancy.com/'), 'https://social.therestisaccountancy.com/social');
  assert.equal(route('https://social.therestisaccountancy.com/@aina?tab=1'), 'https://social.therestisaccountancy.com/social/@aina?tab=1');
  assert.equal(route('https://social.therestisaccountancy.com/edit?_action=saveProfile'), 'https://social.therestisaccountancy.com/social/edit?_action=saveProfile');
  assert.equal(route('https://social.therestisaccountancy.com/social/edit?_action=saveProfile'), null, 'a form posted back to its own address is not prefixed twice');
  assert.equal(route('https://social.therestisaccountancy.com/_astro/app.css'), null);
  assert.equal(route('https://social.therestisaccountancy.com/_actions/follow'), null);
  assert.equal(route('https://social.therestisaccountancy.com/favicon.svg'), null);
  assert.equal(route('http://social.localhost:4174/list'), 'http://social.localhost:4174/social/list');
  assert.equal(route('https://therestisaccountancy.com/'), null, 'the club host is untouched');

  const seen = (address: string) => addressed(new URL(address)).href;
  assert.equal(seen('https://social.therestisaccountancy.com/social/edit?_action=x'), 'https://social.therestisaccountancy.com/edit?_action=x');
  assert.equal(seen('https://social.therestisaccountancy.com/social'), 'https://social.therestisaccountancy.com/');
  assert.equal(seen('http://localhost:4174/social/edit'), 'http://localhost:4174/social/edit', 'elsewhere /social is part of the address');
  assert.equal(socialRoute(addressed(new URL('https://social.therestisaccountancy.com/social/@aina')))?.pathname, '/social/@aina', 'the two undo each other');
});

test('links to social pages and back to the club work from every host', () => {
  const social = new URL('https://social.therestisaccountancy.com/social/list');
  const club = new URL('https://therestisaccountancy.com/welcome');
  const local = new URL('http://localhost:4174/social/list');
  assert.equal(socialPath(social, '/edit'), '/edit');
  assert.equal(socialPath(club, '/me'), 'https://social.therestisaccountancy.com/me');
  assert.equal(socialPath(local, '/edit'), '/social/edit');
  assert.equal(socialPath(local, '/'), '/social');
  assert.equal(socialPathOf(social), '/list');
  assert.equal(socialPathOf(new URL('https://social.therestisaccountancy.com/social')), '/');
  assert.equal(socialPathOf(new URL('http://localhost:4174/socialite')), '/socialite', 'only the /social segment is dropped');
  assert.equal(clubPath(social, '/forgot'), 'https://therestisaccountancy.com/forgot');
  assert.equal(clubPath(local, '/forgot'), '/forgot');
  assert.equal(signInPath(social, '/edit'), `https://therestisaccountancy.com/sign-in?next=${encodeURIComponent('https://social.therestisaccountancy.com/edit')}`);
  assert.equal(signInPath(local, '/edit'), `/sign-in?next=${encodeURIComponent('/social/edit')}`);
  assert.equal(safeNext(new URL(signInPath(social, '/edit')).searchParams.get('next')), 'https://social.therestisaccountancy.com/edit', 'sign-in accepts the way back');
});


test('members-only reading needs a paid or grace membership; admins never pay', () => {
  assert.equal(paidAccess('member', 'paid'), true);
  assert.equal(paidAccess('member', 'grace'), true);
  assert.equal(paidAccess('member', 'unpaid'), false);
  assert.equal(paidAccess('admin', 'unpaid'), true);
});

test('emailed social links go to the social host from the configured site, and stay local in development', () => {
  assert.equal(socialUrl('https://therestisaccountancy.com', '/verify/email?token=abc'), 'https://social.therestisaccountancy.com/verify/email?token=abc');
  assert.equal(socialUrl('http://localhost:4174/', '/@priya'), 'http://localhost:4174/social/@priya');
  assert.equal(isSocialPage('/social/review'), true);
  assert.equal(isSocialPage('/social'), true);
  assert.equal(isSocialPage('/socially'), false);
});

test('signing in comes back to the same social page and query, without the form action that was posted', () => {
  assert.equal(socialHere(new URL('http://127.0.0.1:8799/social/sign-up?invite=abc&_action=socialSignUp')), '/sign-up?invite=abc');
  assert.equal(socialHere(new URL('https://social.therestisaccountancy.com/list')), '/list');
});
