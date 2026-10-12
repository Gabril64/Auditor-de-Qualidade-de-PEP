import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { errorMessage } from "./errorMessage.js";
import { saveRawPatientRecords, type RecordSource } from "./repositories/rawRecords.js";
import type { RawAuditResult } from "./transformer.js";

export type JobStatus = "processing" | "failed" | "partial" | "done";

type RawRecord = Record<string, unknown>;

interface PatientGroup {
  number: string;
  displayNumber: string;
  encounter: unknown;
  records: RawRecord[];
}

interface QueuedJob {
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

export interface PublishedJob {
  record_number: string;
  job_id: string;
}

export interface PublishResult {
  batchId: string;
  publishedJobs: PublishedJob[];
}

export interface StoredResult extends RawAuditResult {
  _job_failed?: boolean;
  error?: string;
  attempts?: number;
  audit_data?: NonNullable<RawAuditResult["audit_data"]> & { ia_incompleta?: boolean };
}

const QUEUE_KEY = "fila:prontuarios";
const RESULT_KEY_PREFIX = "resultado:";

const redis = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
redis.on("error", (error) => console.error("Redis Client Error", error));
await redis.connect();

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

function parsePayload(rawText: string): unknown[] {
  const parsed = parseJsonOrObjectList(rawText.trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertValidRecords(records: unknown[]): asserts records is RawRecord[] {
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

function groupByRecordNumber(records: RawRecord[]): PatientGroup[] {
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

function buildJob(group: PatientGroup, batchId: string, modelName?: string, seed?: number | null): QueuedJob {
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

/** Validates the whole batch, stores the submitted records, then queues one job per patient
 * record number. One invalid record rejects the batch, and nothing is queued if it cannot be stored. */
export async function publishBatch(
  rawText: string,
  modelName?: string,
  seed?: number | null,
  source: RecordSource = "api",
): Promise<PublishResult> {
  const batchId = randomUUID();
  const records = parsePayload(rawText);
  assertValidRecords(records);

  const jobs = groupByRecordNumber(records).map((group) => buildJob(group, batchId, modelName, seed));

  saveRawPatientRecords(
    jobs.map((job) => ({
      jobId: job.job_id,
      batchId,
      recordNumber: job.record_number,
      recordNumberDisplay: job.record_number_display,
      records: job.records,
    })),
    { source, submittedBy: null, submittedAt: new Date().toISOString() },
  );

  for (const job of jobs) {
    await redis.lPush(QUEUE_KEY, JSON.stringify(job));
  }

  return { batchId, publishedJobs: jobs.map((job) => ({ record_number: job.record_number, job_id: job.job_id })) };
}

async function readStoredResult(id: string): Promise<StoredResult | null> {
  const value = await redis.get(`${RESULT_KEY_PREFIX}${id}`);
  return value ? (JSON.parse(value) as StoredResult) : null;
}

export function getResult(recordNumber: string): Promise<StoredResult | null> {
  return readStoredResult(recordNumber);
}

export function getJobResult(jobId: string): Promise<StoredResult | null> {
  return readStoredResult(jobId);
}

/** Derives the job state from what is stored: processing, failed, partial (AI did not run on every field) or done. */
export function jobStatusOf(result: StoredResult | null): JobStatus {
  if (!result) return "processing";
  if (result._job_failed) return "failed";
  if (result.audit_data?.ia_incompleta) return "partial";
  return "done";
}
