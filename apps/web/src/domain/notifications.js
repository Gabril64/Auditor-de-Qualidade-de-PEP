/** The notification list the bell shows: how each one reads, how often to ask, how new ones are merged. */

export const POLL_VISIBLE_MS = 10_000;
export const POLL_HIDDEN_MS = 60_000;
const KEEP = 50;

/** Every 10 s with the tab open, every 60 s in the background. */
export function pollDelayMs(hidden) {
  return hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
}

/** @returns {{title: string, detail: string|null, tone: 'ok'|'warn'|'bad'}} */
export function notificationText(n) {
  const record = n.record_number_display ? `Prontuário ${n.record_number_display}` : 'Prontuário';
  if (n.type === 'audit_done') return { title: `${record}: auditoria concluída`, detail: null, tone: 'ok' };
  if (n.type === 'audit_partial') {
    return { title: `${record}: auditoria incompleta`, detail: n.detail ?? 'A IA falhou em alguns campos.', tone: 'warn' };
  }
  return { title: `${record}: a auditoria falhou`, detail: n.detail ?? null, tone: 'bad' };
}

/** Adds the notifications that arrived, newest first, without repeating any, keeping the latest 50. */
export function mergeNotifications(current, incoming) {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const n of incoming) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, KEEP);
}

/** The id to ask `after` with, or null when nothing is held yet. */
export function lastNotificationId(list) {
  return list.length === 0 ? null : Math.max(...list.map((n) => n.id));
}
