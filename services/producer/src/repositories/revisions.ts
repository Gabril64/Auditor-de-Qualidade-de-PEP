import { getDb } from "../db/connection.js";
import type { AuditFieldRow } from "../domain/auditFields.js";

export interface RevisionRow {
  id: number;
  audit_id: number;
  audit_data: string;
  conformity_percent: number;
  created_at: string;
  updated_at: string;
  updated_by: number | null;
  deleted_at: string | null;
  deleted_by: number | null;
}

export interface RevisionFieldRow extends Omit<AuditFieldRow, "source"> {
  source: AuditFieldRow["source"] | "human";
  updated_at: string | null;
  updated_by: number | null;
}

function db() {
  const connection = getDb();
  if (!connection) throw new Error("Database unavailable");
  return connection;
}

export function getRevision(auditId: number): RevisionRow | null {
  return (db().prepare("SELECT * FROM audit_revisions WHERE audit_id = ?").get(auditId) as RevisionRow | undefined) ?? null;
}

export function getRevisionFields(auditId: number): RevisionFieldRow[] {
  return db()
    .prepare(
      `SELECT section, record_type, field, value, status, source, updated_at, updated_by
       FROM audit_revision_fields WHERE audit_id = ? ORDER BY id`,
    )
    .all(auditId) as RevisionFieldRow[];
}

/** Creates the current version as a copy of the original: its JSON and its fields. */
export function createRevision(auditId: number, auditDataJson: string, conformityPercent: number, now: string): void {
  db()
    .prepare(
      `INSERT INTO audit_revisions (audit_id, audit_data, conformity_percent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(auditId, auditDataJson, conformityPercent, now, now);
  db()
    .prepare(
      `INSERT INTO audit_revision_fields (audit_id, section, record_type, field, value, status, source)
       SELECT audit_id, section, record_type, field, value, status, source FROM audit_fields WHERE audit_id = ?`,
    )
    .run(auditId);
}

export function updateRevisionField(
  auditId: number,
  row: Pick<AuditFieldRow, "section" | "record_type" | "field" | "value" | "status">,
  now: string,
  userId: number,
): void {
  db()
    .prepare(
      `UPDATE audit_revision_fields
       SET value = ?, status = ?, source = 'human', updated_at = ?, updated_by = ?
       WHERE audit_id = ? AND section = ? AND IFNULL(record_type, '') = IFNULL(?, '') AND field = ?`,
    )
    .run(row.value, row.status, now, userId, auditId, row.section, row.record_type, row.field);
}

export function updateRevisionJson(
  auditId: number,
  auditDataJson: string,
  conformityPercent: number,
  now: string,
  userId: number,
): void {
  db()
    .prepare(
      `UPDATE audit_revisions SET audit_data = ?, conformity_percent = ?, updated_at = ?, updated_by = ?
       WHERE audit_id = ?`,
    )
    .run(auditDataJson, conformityPercent, now, userId, auditId);
}

/** Marks the audit as deleted (or clears the mark with null). Nothing leaves the database. */
export function setRevisionDeleted(auditId: number, deletedAt: string | null, userId: number | null): void {
  db()
    .prepare("UPDATE audit_revisions SET deleted_at = ?, deleted_by = ? WHERE audit_id = ?")
    .run(deletedAt, deletedAt ? userId : null, auditId);
}
