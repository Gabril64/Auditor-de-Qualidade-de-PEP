import test from 'node:test';
import assert from 'node:assert/strict';
import { actionLabel, historyGroups, itemLabels, lastEdit, placeLabel } from './auditHistory.js';

const edit = (over) => ({
  id: 1,
  action: 'field_edit',
  user_id: 7,
  user_name: 'Ana',
  created_at: '2026-10-12T10:00:00.000Z',
  section: 'B',
  record_type: 'anamnesis',
  field: 'queixa_principal',
  old_value: 'não conforme',
  new_value: 'conforme (ok)',
  old_status: 'nao_conforme',
  new_status: 'conforme',
  revision_version: null,
  ...over,
});

test('historyGroups folds the fields of one save into a single block', () => {
  const groups = historyGroups([edit(), edit({ id: 2, field: 'hda' })]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].changes.map((c) => c.label), ['queixa_principal', 'hda']);
  assert.equal(groups[0].user, 'Ana');
});

test('historyGroups keeps separate blocks for another instant or another person', () => {
  const groups = historyGroups([
    edit(),
    edit({ id: 2, created_at: '2026-10-12T11:00:00.000Z' }),
    edit({ id: 3, created_at: '2026-10-12T11:00:00.000Z', user_id: 9, user_name: 'Bruno' }),
  ]);
  assert.deepEqual(groups.map((g) => g.id), [3, 2, 1]);
});

test('historyGroups returns the newest block first and keeps the other actions apart', () => {
  const groups = historyGroups([
    edit(),
    { ...edit({ id: 2 }), action: 'approve', field: null, section: null, record_type: null, revision_version: '2026-10-12T10:00:00.000Z' },
  ]);
  assert.deepEqual(groups.map((g) => g.action), ['approve', 'field_edit']);
  assert.deepEqual(groups[0].changes, []);
  assert.equal(groups[0].version, '2026-10-12T10:00:00.000Z');
});

test('historyGroups takes an empty or missing history', () => {
  assert.deepEqual(historyGroups([]), []);
  assert.deepEqual(historyGroups(undefined), []);
});

test('historyGroups names each change after the audited item', () => {
  const labels = { 'B:anamnesis:queixa_principal': 'Queixa principal' };
  const [group] = historyGroups([edit()], labels);
  assert.equal(group.changes[0].label, 'Queixa principal');
  assert.equal(group.changes[0].place, 'Seção B · anamnese');
  assert.equal(group.changes[0].fromValue, 'não conforme');
  assert.equal(group.changes[0].toValue, 'conforme (ok)');
});

test('itemLabels reads the items of flat and grouped sections, skipping what has no ref', () => {
  const audit = {
    secoes: [
      { id: 'A', itens: [{ item: 'Nome', ref: { section: 'A', record_type: null, field: 'nome' } }, { item: 'Extra', ref: null }] },
      {
        id: 'B',
        subgrupos: [{ itens: [{ item: 'HDA', ref: { section: 'B', record_type: 'evolution', field: 'hda' } }] }],
      },
    ],
  };
  assert.deepEqual(itemLabels(audit), { 'A::nome': 'Nome', 'B:evolution:hda': 'HDA' });
  assert.deepEqual(itemLabels(null), {});
});

test('labels for actions and places are the ones the screen shows', () => {
  assert.equal(actionLabel('field_edit'), 'Edição');
  assert.equal(actionLabel('revoke_approval'), 'Aprovação retirada');
  assert.equal(actionLabel('whatever'), 'whatever');
  assert.equal(placeLabel('A', null), 'Seção A');
  assert.equal(placeLabel('D', 'evolution'), 'Seção D · evolução');
});

test('lastEdit: quem salvou a última edição de campo, ignorando aprovações', () => {
  const history = [
    edit({ id: 1, user_name: 'Ana', created_at: '2026-10-12T10:00:00.000Z' }),
    edit({ id: 2, user_name: 'João', created_at: '2026-10-12T11:00:00.000Z' }),
    { id: 3, action: 'approve', user_name: 'Maria', created_at: '2026-10-12T12:00:00.000Z' },
  ];
  assert.deepEqual(lastEdit(history), { user: 'João', at: '2026-10-12T11:00:00.000Z' });
  assert.equal(lastEdit([]), null);
});
