import assert from 'node:assert/strict';
import { test } from 'node:test';

import { approvalSeal, needsApproval } from './approvals.js';

test('aprovado: lista quem aprovou, com "e" antes do último', () => {
  assert.deepEqual(approvalSeal({ approval_status: 'approved', approved_by: ['Maria'] }), { tone: 'ok', label: 'Aprovado por Maria' });
  assert.equal(approvalSeal({ approval_status: 'approved', approved_by: ['Maria', 'João'] }).label, 'Aprovado por Maria e João');
  assert.equal(approvalSeal({ approval_status: 'approved', approved_by: ['Ana', 'Maria', 'João'] }).label, 'Aprovado por Ana, Maria e João');
});

test('aprovado antes da última edição é âmbar; sem aprovação é pendente', () => {
  assert.deepEqual(approvalSeal({ approval_status: 'approved_before_edit' }), { tone: 'warn', label: 'Aprovado antes da última edição' });
  assert.deepEqual(approvalSeal({ approval_status: 'pending' }), { tone: 'muted', label: 'Pendente' });
  assert.deepEqual(approvalSeal({}), { tone: 'muted', label: 'Pendente' });
});

test('precisa de aprovação: tudo o que não está aprovado na versão atual', () => {
  assert.equal(needsApproval({ approval_status: 'approved' }), false);
  assert.equal(needsApproval({ approval_status: 'approved_before_edit' }), true);
  assert.equal(needsApproval({ approval_status: 'pending' }), true);
});
