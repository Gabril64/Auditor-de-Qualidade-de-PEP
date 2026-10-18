import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyTheme, readTheme } from './theme.js';

const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
};
const fakeRoot = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });

test('the default is dark; only a stored "light" counts as light', () => {
  assert.equal(readTheme(fakeStorage()), 'dark');
  assert.equal(readTheme(fakeStorage({ theme: 'light' })), 'light');
  assert.equal(readTheme(fakeStorage({ theme: 'qualquer' })), 'dark');
});

test('storage that fails does not break anything', () => {
  const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.equal(readTheme(quebrado), 'dark');
  const root = fakeRoot();
  applyTheme('light', root, quebrado);
  assert.equal(root.attrs['data-theme'], 'light');
});

test('applyTheme marks the page and stores the choice', () => {
  const root = fakeRoot();
  const storage = fakeStorage();
  applyTheme('light', root, storage);
  assert.equal(root.attrs['data-theme'], 'light');
  assert.equal(storage.data.theme, 'light');
});
