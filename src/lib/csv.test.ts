import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cell, csv } from './csv.ts';

test('cells are quoted when they must be, and formulas are defused', () => {
  assert.equal(cell('Aina Rahman'), 'Aina Rahman');
  assert.equal(cell('Rahman, Aina'), '"Rahman, Aina"');
  assert.equal(cell('Say "hi"'), '"Say ""hi"""');
  assert.equal(cell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(cell('-1'), "'-1");
  assert.equal(csv([['a', 'b'], ['c', 'd']]), '﻿a,b\r\nc,d\r\n');
});
