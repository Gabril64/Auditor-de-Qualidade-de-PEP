import assert from 'node:assert/strict';
import { test } from 'node:test';

import { approvalSeal, needsApproval } from './approvals.js';

test('approved: lists who approved, with "e" before the last name', () => {
  assert.deepEqual(approvalSeal({ approval_status: 'approved', approved_by: ['Maria'] }), { tone: 'ok', label: 'Aprovado por Maria' });
  assert.equal(approvalSeal({ approval_status: 'approved', approved_by: ['Maria', 'João'] }).label, 'Aprovado por Maria e João');
  assert.equal(approvalSeal({ approval_status: 'approved', approved_by: ['Ana', 'Maria', 'João'] }).label, 'Aprovado por Ana, Maria e João');
});

test('approved before the last edit is amber; no approval is pending', () => {
  assert.deepEqual(approvalSeal({ approval_status: 'approved_before_edit' }), { tone: 'warn', label: 'Aprovado antes da última edição' });
  assert.deepEqual(approvalSeal({ approval_status: 'pending' }), { tone: 'muted', label: 'Pendente' });
  assert.deepEqual(approvalSeal({}), { tone: 'muted', label: 'Pendente' });
});

test('needs approval: everything not approved in the current version', () => {
  assert.equal(needsApproval({ approval_status: 'approved' }), false);
  assert.equal(needsApproval({ approval_status: 'approved_before_edit' }), true);
  assert.equal(needsApproval({ approval_status: 'pending' }), true);
});
