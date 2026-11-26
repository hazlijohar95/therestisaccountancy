import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { site } from './site.ts';
import { socialHost } from './social.ts';

test('the deploy config serves and sends mail from the domain the site uses', () => {
  const config = readFileSync(new URL('../../cloudflare.config.ts', import.meta.url), 'utf8');
  assert.equal(config.match(/^const domain = '([^']+)';$/m)?.[1], site.domain);
  assert.match(config, /^const sender = `club@\$\{domain\}`;$/m);
  assert.equal(site.inbox, `club@${site.domain}`);
  assert.match(config, /^const socialHost = `social\.\$\{domain\}`;$/m);
  assert.equal(socialHost, `social.${site.domain}`);
});
