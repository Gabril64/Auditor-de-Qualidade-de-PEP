import type Database from "better-sqlite3";
import { getDb } from "../db/connection.js";
import { extractAuditFields, type AuditFieldRow } from "../domain/auditFields.js";
import { errorMessage } from "../errorMessage.js";
import type { RawAuditResult } from "../transformer.js";

interface AuditRow {
  id: number;
  batch_id: string;
  job_id: string;
  record_number: string;
  record_number_display: string | null;
  encounter: string | null;
  audit_data: string;
  conformity_percent: number;
  status: string;
  created_at: string;
  original_conformity_percent?: number;
  revised_at?: string | null;
  revised_by?: number | null;
  deleted_at?: string | null;
}

export interface AuditRecord extends Omit<AuditRow, "audit_data"> {
  audit_data: RawAuditResult;
  /** The conformity of the current version: the revision's when the audit was edited. */
  original_conformity_percent?: number;
  revised_at?: string | null;
  revised_by?: number | null;
  deleted_at?: string | null;
}

interface ConformityExtreme {
  record_number: string;
  value: number;
}

export interface DashboardStats {
  total_audits: number;
  avg_conformity: number;
  min_conformity: ConformityExtreme;
  max_conformity: ConformityExtreme;
}

interface ExtremeRow {
  record_number_display: string | null;
  conformity_percent: number;
}

export interface CompletedJob {
  batch_id?: string;
  job_id?: string;
  record_number?: string;
  record_number_display?: string;
  encounter?: string;
  result: RawAuditResult;
}

function insertAuditFields(conn: Database.Database, auditId: number, rows: AuditFieldRow[]): void {
  const insert = conn.prepare(
    `INSERT INTO audit_fields (audit_id, section, record_type, field, value, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(auditId, row.section, row.record_type, row.field, row.value, row.status, row.source);
  }
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

const CURRENT_PERCENTS = `SELECT a.record_number_display, COALESCE(r.conformity_percent, a.conformity_percent) AS conformity_percent
  FROM audit_results a LEFT JOIN audit_revisions r ON r.audit_id = a.id WHERE r.deleted_at IS NULL`;

function emptyStats(): DashboardStats {
  return {
    total_audits: 0,
    avg_conformity: 0,
    min_conformity: { record_number: "", value: 0 },
    max_conformity: { record_number: "", value: 0 },
  };
}

function parseRow(row: AuditRow): AuditRecord {
  return { ...row, audit_data: JSON.parse(row.audit_data) };
}

function toExtreme(row: ExtremeRow | undefined): ConformityExtreme {
  return {
    record_number: row?.record_number_display || "",
    value: row ? roundToTenth(row.conformity_percent) : 0,
  };
}

function currentAuditSelect(auditDataExpression: string): string {
  return `SELECT a.id, a.batch_id, a.job_id, a.record_number, a.record_number_display,
       a.encounter, ${auditDataExpression} AS audit_data,
       COALESCE(r.conformity_percent, a.conformity_percent) AS conformity_percent,
       a.conformity_percent AS original_conformity_percent, a.status, a.created_at,
       r.updated_at AS revised_at, r.updated_by AS revised_by, r.deleted_at AS deleted_at
  FROM audit_results a LEFT JOIN audit_revisions r ON r.audit_id = a.id`;
}

/** Returns every stored audit, most recent first, with the conformity of its current version.
 * Deleted audits are left out unless `onlyDeleted` asks for exactly those. */
export function getAllAudits(onlyDeleted = false): AuditRecord[] {
  const conn = getDb();
  if (!conn) return [];

  try {
    const filter = onlyDeleted ? "r.deleted_at IS NOT NULL" : "r.deleted_at IS NULL";
    const rows = conn
      .prepare(`${currentAuditSelect("COALESCE(r.audit_data, a.audit_data)")} WHERE ${filter} ORDER BY a.created_at DESC`)
      .all() as AuditRow[];
    return rows.map(parseRow);
  } catch (error) {
    console.error("[DB] Error fetching all audits:", errorMessage(error));
    return [];
  }
}

/** Returns one audit by its database id, with its original result, or null when it does not exist. */
export function getAuditById(id: number): AuditRecord | null {
  const conn = getDb();
  if (!conn) return null;

  try {
    const row = conn.prepare(`${currentAuditSelect("a.audit_data")} WHERE a.id = ?`).get(id) as AuditRow | undefined;
    return row ? parseRow(row) : null;
  } catch (error) {
    console.error("[DB] Error fetching audit by ID:", errorMessage(error));
    return null;
  }
}

/** Returns totals, the average and the lowest and highest conformity. */
export function getDashboardStats(): DashboardStats {
  const conn = getDb();
  if (!conn) return emptyStats();

  try {
    const { total } = conn.prepare(`SELECT COUNT(*) AS total FROM (${CURRENT_PERCENTS})`).get() as { total: number };
    if (total === 0) return emptyStats();

    const { average } = conn.prepare(`SELECT AVG(conformity_percent) AS average FROM (${CURRENT_PERCENTS})`).get() as {
      average: number | null;
    };
    const extreme = (direction: "ASC" | "DESC") =>
      conn
        .prepare(
          `SELECT record_number_display, conformity_percent FROM (${CURRENT_PERCENTS})
           ORDER BY conformity_percent ${direction} LIMIT 1`,
        )
        .get() as ExtremeRow | undefined;

    return {
      total_audits: total,
      avg_conformity: average ? roundToTenth(average) : 0,
      min_conformity: toExtreme(extreme("ASC")),
      max_conformity: toExtreme(extreme("DESC")),
    };
  } catch (error) {
    console.error("[DB] Error fetching dashboard stats:", errorMessage(error));
    return emptyStats();
  }
}

/** Returns the original audit field by field, in the order they were stored. */
export function getAuditFields(auditId: number): AuditFieldRow[] {
  const conn = getDb();
  if (!conn) return [];

  try {
    return conn
      .prepare(
        `SELECT section, record_type, field, value, status, source
         FROM audit_fields WHERE audit_id = ? ORDER BY id`,
      )
      .all(auditId) as AuditFieldRow[];
  } catch (error) {
    console.error("[DB] Error fetching audit fields:", errorMessage(error));
    return [];
  }
}

/** Inserts a finished audit and its fields in one transaction, or updates both in place if the
 * same job_id was already saved. Returns false when the database is unavailable or the write
 * fails (logged either way). */
export function upsertAuditResult(job: CompletedJob): boolean {
  const conn = getDb();
  if (!conn) return false;

  try {
    const auditData = job.result.audit_data ?? job.result;
    const conformityPercent = auditData?.conformity_global?.percent ?? 0;
    const auditDataJson = JSON.stringify(job.result);
    const jobId = job.job_id ?? "unknown";

    conn.transaction(() => {
      const existing = conn.prepare("SELECT id FROM audit_results WHERE job_id = ?").get(jobId) as
        | { id: number }
        | undefined;
      let auditId: number;

      if (existing) {
        conn
          .prepare("UPDATE audit_results SET audit_data = ?, conformity_percent = ?, status = 'done' WHERE job_id = ?")
          .run(auditDataJson, conformityPercent, jobId);
        conn.prepare("DELETE FROM audit_fields WHERE audit_id = ?").run(existing.id);
        auditId = existing.id;
      } else {
        const inserted = conn
          .prepare(
            `INSERT INTO audit_results
             (batch_id, job_id, record_number, record_number_display, encounter, audit_data, conformity_percent, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'done', ?)`,
          )
          .run(
            job.batch_id ?? "unknown",
            jobId,
            job.record_number ?? "unknown",
            job.record_number_display ?? job.record_number ?? "",
            job.encounter ?? "",
            auditDataJson,
            conformityPercent,
            new Date().toISOString(),
          );
        auditId = Number(inserted.lastInsertRowid);
      }

      insertAuditFields(conn, auditId, extractAuditFields(job.result));
    })();
    return true;
  } catch (error) {
    console.error(`[DB] Error saving result for job ${job.job_id}:`, errorMessage(error));
    return false;
  }
}
