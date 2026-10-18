/** How the approval of an audit is told on screen: the seal text and whether it still needs a review. */

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

/**
 * @param {{approval_status?: string, approved_by?: string[]}} audit - A list row or the detail
 * @returns {{tone: 'ok'|'warn'|'muted', label: string}}
 */
export function approvalSeal(audit) {
  if (audit?.approval_status === 'approved') {
    return { tone: 'ok', label: `Aprovado por ${joinNames(audit.approved_by ?? [])}` };
  }
  if (audit?.approval_status === 'approved_before_edit') {
    return { tone: 'warn', label: 'Aprovado antes da última edição' };
  }
  return { tone: 'muted', label: 'Pendente' };
}

/** The filter "precisa de aprovação": pending, or approved only before the last edit. */
export function needsApproval(audit) {
  return audit?.approval_status !== 'approved';
}
