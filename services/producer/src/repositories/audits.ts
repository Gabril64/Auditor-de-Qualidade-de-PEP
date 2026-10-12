import { getDb } from "../db/connection.js";
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
}

export interface AuditRecord extends Omit<AuditRow, "audit_data"> {
  audit_data: RawAuditResult;
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

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

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

/** Returns every stored audit, most recent first. */
export function getAllAudits(): AuditRecord[] {
  const conn = getDb();
  if (!conn) return [];

  try {
    const rows = conn
      .prepare(
        `SELECT id, batch_id, job_id, record_number, record_number_display,
                encounter, audit_data, conformity_percent, status, created_at
         FROM audit_results
         ORDER BY created_at DESC`,
      )
      .all() as AuditRow[];
    return rows.map(parseRow);
  } catch (error) {
    console.error("[DB] Error fetching all audits:", errorMessage(error));
    return [];
  }
}

/** Returns one audit by its database id, or null when it does not exist. */
export function getAuditById(id: number): AuditRecord | null {
  const conn = getDb();
  if (!conn) return null;

  try {
    const row = conn.prepare("SELECT * FROM audit_results WHERE id = ?").get(id) as AuditRow | undefined;
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
    const { total } = conn.prepare("SELECT COUNT(*) AS total FROM audit_results").get() as { total: number };
    if (total === 0) return emptyStats();

    const { average } = conn.prepare("SELECT AVG(conformity_percent) AS average FROM audit_results").get() as {
      average: number | null;
    };
    const extreme = (direction: "ASC" | "DESC") =>
      conn
        .prepare(
          `SELECT record_number_display, conformity_percent FROM audit_results
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

/** Inserts a finished audit, or updates it in place if the same job_id was already saved.
 * Returns false when the database is unavailable or the write fails (logged either way). */
export function upsertAuditResult(job: CompletedJob): boolean {
  const conn = getDb();
  if (!conn) return false;

  try {
    const auditData = job.result.audit_data ?? job.result;
    const conformityPercent = auditData?.conformity_global?.percent ?? 0;
    const auditDataJson = JSON.stringify(job.result);
    const jobId = job.job_id ?? "unknown";

    const existing = conn.prepare("SELECT id FROM audit_results WHERE job_id = ?").get(jobId);
    if (existing) {
      conn
        .prepare("UPDATE audit_results SET audit_data = ?, conformity_percent = ?, status = 'done' WHERE job_id = ?")
        .run(auditDataJson, conformityPercent, jobId);
    } else {
      conn
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
    }
    return true;
  } catch (error) {
    console.error(`[DB] Error saving result for job ${job.job_id}:`, errorMessage(error));
    return false;
  }
}
