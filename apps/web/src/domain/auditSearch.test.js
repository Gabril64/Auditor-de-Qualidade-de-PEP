import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchesSearch } from './auditSearch.js';

const audit = { record_number: '94098934', record_number_display: '94.098.934', encounter: '5512' };

test('an empty search lets everything through', () => {
  assert.equal(matchesSearch(audit, ''), true);
  assert.equal(matchesSearch(audit, '   '), true);
  assert.equal(matchesSearch(audit, undefined), true);
});

test('finds the prontuário with or without dots, whole or in part', () => {
  assert.equal(matchesSearch(audit, '94.098.934'), true);
  assert.equal(matchesSearch(audit, '94098934'), true);
  assert.equal(matchesSearch(audit, '098.9'), true);
  assert.equal(matchesSearch(audit, '0989'), true);
});

test('finds by attendance number', () => {
  assert.equal(matchesSearch(audit, '5512'), true);
});

test('does not find a different number', () => {
  assert.equal(matchesSearch(audit, '12345'), false);
  assert.equal(matchesSearch(audit, 'abc'), false);
});

test('a row without numbers does not break', () => {
  assert.equal(matchesSearch({}, '123'), false);
  assert.equal(matchesSearch(null, ''), true);
});
