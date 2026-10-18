import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lastNotificationId, mergeNotifications, notificationText, pollDelayMs } from './notifications.js';

test('the interval is 10 s with the tab open and 60 s in the background', () => {
  assert.equal(pollDelayMs(false), 10_000);
  assert.equal(pollDelayMs(true), 60_000);
});

test('each outcome has its own text', () => {
  const base = { record_number_display: '12.345', detail: null };
  assert.deepEqual(notificationText({ ...base, type: 'audit_done' }), { title: 'Prontuário 12.345: auditoria concluída', detail: null, tone: 'ok' });
  assert.equal(notificationText({ ...base, type: 'audit_partial' }).tone, 'warn');
  assert.equal(notificationText({ ...base, type: 'audit_failed', detail: 'boom' }).detail, 'boom');
  assert.match(notificationText({ type: 'audit_done', record_number_display: null }).title, /^Prontuário:/);
});

test('merges without repeating, newest first, and keeps 50 at most', () => {
  const merged = mergeNotifications([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(merged.map((n) => n.id), [3, 2, 1]);

  const many = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }));
  assert.equal(mergeNotifications([], many).length, 50);
  assert.equal(mergeNotifications([], many)[0].id, 60);
});

test('the last id serves as "after"; an empty list asks for the first page', () => {
  assert.equal(lastNotificationId([]), null);
  assert.equal(lastNotificationId([{ id: 4 }, { id: 9 }, { id: 6 }]), 9);
});
