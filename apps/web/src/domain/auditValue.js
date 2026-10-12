/**
 * Helpers for editing an audited item: the text of a field is "conforme (comentário)" or
 * "não conforme (comentário)"; the server rebuilds it from a status and a comment.
 */

const STATUS_PREFIX = /^\s*(conforme|n[ãa]o conforme|n[ãa]o registrado)\s*(?:\(([\s\S]*)\))?\s*$/i;
const NOT_AVAILABLE = 'N/A';

/** Stable identity of an item's ref, used to key drafts and originals. */
export function refKey(ref) {
  return `${ref.section}:${ref.record_type ?? ''}:${ref.field}`;
}

/** The comment held in an item's text: what is inside the parentheses, or the plain value itself. */
export function commentOf(valor) {
  const text = String(valor ?? '').trim();
  if (text === '' || text === NOT_AVAILABLE) return '';

  const match = STATUS_PREFIX.exec(text);
  if (match) return (match[2] ?? '').trim();
  return text;
}

/** The status the editor starts from: "não se aplica" and anything else not flagged counts as conforme. */
export function baseStatusOf(item) {
  return item.status === 'nao_conforme' ? 'nao_conforme' : 'conforme';
}

/** The editor's starting point for an item. */
export function baseDraftOf(item) {
  return { status: baseStatusOf(item), comment: commentOf(item.valor) };
}

export function sameDraft(a, b) {
  return a.status === b.status && a.comment.trim() === b.comment.trim();
}

/** The `changes` list for PATCH /api/audits/:id/revision, from the drafts keyed by `refKey`. */
export function changesFromDrafts(drafts) {
  return Object.values(drafts).map(({ ref, status, comment }) => ({
    section: ref.section,
    record_type: ref.record_type,
    field: ref.field,
    status,
    comment: comment.trim() === '' ? undefined : comment.trim(),
  }));
}
