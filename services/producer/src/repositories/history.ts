import { getDb } from "../db/connection.js";

export type HistoryAction = "field_edit" | "approve" | "revoke_approval" | "delete" | "restore";

export interface HistoryEntry {
  auditId: number;
  action: HistoryAction;
  userId: number;
  createdAt: string;
  section?: string | null;
  recordType?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  oldStatus?: string | null;
  newStatus?: string | null;
  revisionVersion?: string | null;
}

export interface HistoryRow {
  id: number;
  audit_id: number;
  action: HistoryAction;
  user_id: number;
  user_name: string;
  created_at: string;
  section: string | null;
  record_type: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  old_status: string | null;
  new_status: string | null;
  revision_version: string | null;
}

function db() {
  const connection = getDb();
  if (!connection) throw new Error("Database unavailable");
  return connection;
}

export function addHistory(entry: HistoryEntry): void {
  db()
    .prepare(
      `INSERT INTO audit_history
       (audit_id, action, user_id, created_at, section, record_type, field,
        old_value, new_value, old_status, new_status, revision_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.auditId,
      entry.action,
      entry.userId,
      entry.createdAt,
      entry.section ?? null,
      entry.recordType ?? null,
      entry.field ?? null,
      entry.oldValue ?? null,
      entry.newValue ?? null,
      entry.oldStatus ?? null,
      entry.newStatus ?? null,
      entry.revisionVersion ?? null,
    );
}

const SELECT_HISTORY = `SELECT h.id, h.audit_id, h.action, h.user_id, u.name AS user_name, h.created_at, h.section,
       h.record_type, h.field, h.old_value, h.new_value, h.old_status, h.new_status, h.revision_version
  FROM audit_history h JOIN users u ON u.id = h.user_id`;

export function listHistory(auditId: number): HistoryRow[] {
  return db().prepare(`${SELECT_HISTORY} WHERE h.audit_id = ? ORDER BY h.id`).all(auditId) as HistoryRow[];
}

/** Every approval and revocation of the given audits, oldest first. */
export function listApprovalEvents(auditIds: number[]): HistoryRow[] {
  if (auditIds.length === 0) return [];
  const marks = auditIds.map(() => "?").join(", ");
  return db()
    .prepare(
      `${SELECT_HISTORY}
       WHERE h.action IN ('approve', 'revoke_approval') AND h.audit_id IN (${marks}) ORDER BY h.id`,
    )
    .all(...auditIds) as HistoryRow[];
}
