import { createHash } from "node:crypto";
import { RAW_RECORD_COLUMNS } from "../domain/rawRecordColumns.js";
import { getDb } from "../db/connection.js";

export type RecordSource = "upload" | "api";

export interface RawPatientRecordInput {
  jobId: string;
  batchId: string;
  recordNumber: string;
  recordNumberDisplay: string;
  records: Record<string, unknown>[];
}

export interface RawSubmission {
  source: RecordSource;
  submittedBy: number | null;
  submittedAt: string;
}

export interface RawEntry {
  position: number;
  fields: Record<string, string | null>;
  original: Record<string, unknown>;
  extra_keys: Record<string, unknown> | null;
}

export interface RawPatientRecord {
  id: number;
  job_id: string;
  batch_id: string;
  record_number: string;
  record_number_display: string;
  sha256: string;
  source: RecordSource;
  submitted_by: number | null;
  submitted_at: string;
  entries: RawEntry[];
}

const COLUMN_NAMES = RAW_RECORD_COLUMNS.map(([, column]) => column);
const KNOWN_KEYS = new Set(RAW_RECORD_COLUMNS.map(([key]) => key));

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

function extraKeysOf(record: Record<string, unknown>): string | null {
  const extra = Object.fromEntries(Object.entries(record).filter(([key]) => !KNOWN_KEYS.has(key)));
  return Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;
}

/** Stores the submitted patient records, one `raw_patient_records` row per job and one
 * `raw_record_entries` row per entry, all in one transaction. Throws if the database is
 * unavailable or the write fails, so the caller never queues a job it could not store. */
export function saveRawPatientRecords(inputs: RawPatientRecordInput[], submission: RawSubmission): void {
  const db = getDb();
  if (!db) throw new Error("Database unavailable: could not store the submitted records");

  const insertRecord = db.prepare(
    `INSERT INTO raw_patient_records
       (job_id, batch_id, record_number, record_number_display, sha256, source, submitted_by, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEntry = db.prepare(
    `INSERT INTO raw_record_entries
       (raw_patient_record_id, position, ${COLUMN_NAMES.join(", ")}, original_json, extra_keys)
     VALUES (?, ?, ${COLUMN_NAMES.map(() => "?").join(", ")}, ?, ?)`,
  );

  db.transaction(() => {
    for (const input of inputs) {
      const sha256 = createHash("sha256").update(JSON.stringify(input.records)).digest("hex");
      const { lastInsertRowid } = insertRecord.run(
        input.jobId,
        input.batchId,
        input.recordNumber,
        input.recordNumberDisplay,
        sha256,
        submission.source,
        submission.submittedBy,
        submission.submittedAt,
      );

      input.records.forEach((record, position) => {
        insertEntry.run(
          lastInsertRowid,
          position,
          ...RAW_RECORD_COLUMNS.map(([key]) => asText(record[key])),
          JSON.stringify(record),
          extraKeysOf(record),
        );
      });
    }
  })();
}

interface RecordRow {
  id: number;
  job_id: string;
  batch_id: string;
  record_number: string;
  record_number_display: string;
  sha256: string;
  source: RecordSource;
  submitted_by: number | null;
  submitted_at: string;
}

interface EntryRow extends Record<string, string | number | null> {
  position: number;
  original_json: string;
  extra_keys: string | null;
}

/** Returns the stored submission for an audit job, or null when none was stored (audits that
 * predate this table, or a job id that does not exist). */
export function getRawPatientRecordByJobId(jobId: string): RawPatientRecord | null {
  const db = getDb();
  if (!db) return null;

  const record = db.prepare("SELECT * FROM raw_patient_records WHERE job_id = ?").get(jobId) as RecordRow | undefined;
  if (!record) return null;

  const rows = db
    .prepare("SELECT * FROM raw_record_entries WHERE raw_patient_record_id = ? ORDER BY position")
    .all(record.id) as EntryRow[];

  const entries = rows.map((row) => ({
    position: row.position,
    fields: Object.fromEntries(COLUMN_NAMES.map((column) => [column, row[column] as string | null])),
    original: JSON.parse(row.original_json) as Record<string, unknown>,
    extra_keys: row.extra_keys ? (JSON.parse(row.extra_keys) as Record<string, unknown>) : null,
  }));

  return { ...record, entries };
}
