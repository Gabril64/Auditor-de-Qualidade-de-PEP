import { randomUUID } from "node:crypto";
import { errorMessage } from "../errorMessage.js";

export type RawRecord = Record<string, unknown>;

export interface PatientGroup {
  number: string;
  displayNumber: string;
  encounter: unknown;
  records: RawRecord[];
}

export interface QueuedJob {
  job_id: string;
  batch_id: string;
  record_number: string;
  record_number_display: string;
  encounter: unknown;
  total_entries: number;
  records: RawRecord[];
  created_at: string;
  attempts: number;
  model_name?: string;
  seed?: number;
}

function normalizeRecordNumber(recordNumber: string): string {
  return recordNumber.replace(/\./g, "").trim();
}

function parseCommaSeparatedObjects(text: string): unknown {
  try {
    return JSON.parse(`[${text}]`);
  } catch (error) {
    throw new Error(`Invalid payload, could not parse: ${errorMessage(error)}`);
  }
}

function parseJsonOrObjectList(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return parseCommaSeparatedObjects(text);
  }
}

/** Accepts a JSON array, a single object, or a bare `{...},{...}` list, and returns the entries. */
export function parsePayload(rawText: string): unknown[] {
  const parsed = parseJsonOrObjectList(rawText.trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Throws on the first entry that is not an object or has no `Prontuário`. */
export function assertValidRecords(records: unknown[]): asserts records is RawRecord[] {
  records.forEach((record, index) => {
    const position = index + 1;
    if (!isRecord(record)) {
      throw new Error(`Invalid payload: record ${position} is not an object`);
    }
    const number = record["Prontuário"];
    if (number === null || number === undefined || String(number).trim() === "") {
      throw new Error(`Invalid payload: record ${position} is missing "Prontuário"`);
    }
  });
}

/** Groups entries by patient record number, ignoring dots. Keeps the first entry's display number. */
export function groupByRecordNumber(records: RawRecord[]): PatientGroup[] {
  const groups = new Map<string, PatientGroup>();

  for (const record of records) {
    const displayNumber = String(record["Prontuário"]);
    const number = normalizeRecordNumber(displayNumber);
    const group: PatientGroup = groups.get(number) ?? {
      number,
      displayNumber,
      encounter: record["Atendimento"],
      records: [],
    };
    group.records.push(record);
    groups.set(number, group);
  }

  return Array.from(groups.values());
}

export function buildJob(group: PatientGroup, batchId: string, modelName?: string, seed?: number | null): QueuedJob {
  const job: QueuedJob = {
    job_id: randomUUID(),
    batch_id: batchId,
    record_number: group.number,
    record_number_display: group.displayNumber,
    encounter: group.encounter,
    total_entries: group.records.length,
    records: group.records,
    created_at: new Date().toISOString(),
    attempts: 0,
  };

  if (modelName) job.model_name = modelName;
  if (seed !== undefined && seed !== null) job.seed = seed;

  return job;
}
