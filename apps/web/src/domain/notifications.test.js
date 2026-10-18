import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lastNotificationId, mergeNotifications, notificationText, pollDelayMs } from './notifications.js';

test('o intervalo é 10 s com a aba aberta e 60 s em segundo plano', () => {
  assert.equal(pollDelayMs(false), 10_000);
  assert.equal(pollDelayMs(true), 60_000);
});

test('cada desfecho tem o seu texto', () => {
  const base = { record_number_display: '12.345', detail: null };
  assert.deepEqual(notificationText({ ...base, type: 'audit_done' }), { title: 'Prontuário 12.345: auditoria concluída', detail: null, tone: 'ok' });
  assert.equal(notificationText({ ...base, type: 'audit_partial' }).tone, 'warn');
  assert.equal(notificationText({ ...base, type: 'audit_failed', detail: 'boom' }).detail, 'boom');
  assert.match(notificationText({ type: 'audit_done', record_number_display: null }).title, /^Prontuário:/);
});

test('mescla sem repetir, mais nova primeiro, e limita a 50', () => {
  const merged = mergeNotifications([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(merged.map((n) => n.id), [3, 2, 1]);

  const many = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }));
  assert.equal(mergeNotifications([], many).length, 50);
  assert.equal(mergeNotifications([], many)[0].id, 60);
});

test('o último id serve de "after"; lista vazia pede a primeira página', () => {
  assert.equal(lastNotificationId([]), null);
  assert.equal(lastNotificationId([{ id: 4 }, { id: 9 }, { id: 6 }]), 9);
});
