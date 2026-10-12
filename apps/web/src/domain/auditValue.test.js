import test from 'node:test';
import assert from 'node:assert/strict';
import { baseDraftOf, changesFromDrafts, commentOf, refKey, sameDraft } from './auditValue.js';

test('commentOf reads what is inside the parentheses', () => {
  assert.equal(commentOf('não conforme (Faltam: queixa, conduta)'), 'Faltam: queixa, conduta');
  assert.equal(commentOf('conforme (15/03/2024)'), '15/03/2024');
});

test('commentOf keeps a plain value and drops the placeholders', () => {
  assert.equal(commentOf('Ortopedia'), 'Ortopedia');
  assert.equal(commentOf('N/A'), '');
  assert.equal(commentOf('não conforme'), '');
  assert.equal(commentOf('Não registrado (IA: null)'), 'IA: null');
  assert.equal(commentOf(null), '');
});

test('baseDraftOf treats anything but nao_conforme as conforme', () => {
  assert.deepEqual(baseDraftOf({ status: 'nao_conforme', valor: 'não conforme (x)' }), {
    status: 'nao_conforme',
    comment: 'x',
  });
  assert.deepEqual(baseDraftOf({ status: 'nao_se_aplica', valor: 'Não se aplica' }).status, 'conforme');
});

test('sameDraft ignores surrounding spaces in the comment', () => {
  assert.equal(sameDraft({ status: 'conforme', comment: 'a ' }, { status: 'conforme', comment: 'a' }), true);
  assert.equal(sameDraft({ status: 'conforme', comment: 'a' }, { status: 'nao_conforme', comment: 'a' }), false);
});

test('changesFromDrafts builds the PATCH body and omits an empty comment', () => {
  const ref = { section: 'B', record_type: 'anamnesis', field: 'hda' };
  const drafts = { [refKey(ref)]: { ref, status: 'conforme', comment: ' ok ' } };
  assert.deepEqual(changesFromDrafts(drafts), [
    { section: 'B', record_type: 'anamnesis', field: 'hda', status: 'conforme', comment: 'ok' },
  ]);

  const empty = { [refKey(ref)]: { ref, status: 'nao_conforme', comment: '' } };
  assert.equal(changesFromDrafts(empty)[0].comment, undefined);
});
