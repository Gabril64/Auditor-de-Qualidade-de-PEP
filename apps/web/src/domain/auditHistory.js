/**
 * Helpers for the change history under the detail screen. The server sends `history` as one row
 * per event, oldest first; here the field edits of a single save (same instant, same person) are
 * folded into one block, and the blocks come back newest first.
 */

import { refKey } from './auditValue.js';

const ACTION_LABELS = {
  field_edit: 'Edição',
  approve: 'Aprovada',
  revoke_approval: 'Aprovação retirada',
  delete: 'Excluída',
  restore: 'Restaurada',
};

const RECORD_TYPE_LABELS = { anamnesis: 'anamnese', evolution: 'evolução' };

export function actionLabel(action) {
  return ACTION_LABELS[action] ?? action;
}

/** Where a change happened, as the detail screen names it: "Seção B · anamnese". */
export function placeLabel(section, recordType) {
  const type = RECORD_TYPE_LABELS[recordType];
  return `Seção ${section}${type ? ` · ${type}` : ''}`;
}

/** refKey → the name the audited item carries, so the history can say "Queixa principal". */
export function itemLabels(audit) {
  const labels = {};

  for (const section of audit?.secoes ?? []) {
    const lists = section.subgrupos ? section.subgrupos.map((group) => group.itens ?? []) : [section.itens ?? []];
    for (const items of lists) {
      for (const item of items) {
        if (item.ref) labels[refKey(item.ref)] = item.item;
      }
    }
  }

  return labels;
}

function changeOf(row, labels) {
  const key = refKey({ section: row.section, record_type: row.record_type, field: row.field });
  return {
    key,
    label: labels[key] ?? row.field,
    place: placeLabel(row.section, row.record_type),
    fromValue: row.old_value,
    toValue: row.new_value,
    fromStatus: row.old_status,
    toStatus: row.new_status,
  };
}

/**
 * The history as blocks for the screen, newest first.
 * @param {Array<object>} history - The `history` rows of GET /api/audits/:id
 * @param {Record<string, string>} labels - refKey → item name, from `itemLabels`
 * @returns {Array<{id: number, action: string, at: string, user: string, version: string|null, changes: Array<object>}>}
 */
export function historyGroups(history, labels = {}) {
  const groups = [];

  for (const row of history ?? []) {
    const edit = row.action === 'field_edit' ? changeOf(row, labels) : null;
    const open = groups.at(-1);

    if (edit && open?.action === 'field_edit' && open.at === row.created_at && open.userId === row.user_id) {
      open.changes.push(edit);
      continue;
    }

    groups.push({
      id: row.id,
      action: row.action,
      at: row.created_at,
      user: row.user_name,
      userId: row.user_id,
      version: row.revision_version ?? null,
      changes: edit ? [edit] : [],
    });
  }

  return groups.reverse();
}
