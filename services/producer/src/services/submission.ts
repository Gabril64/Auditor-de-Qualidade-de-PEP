import { randomUUID } from "node:crypto";
import { assertValidRecords, buildJob, groupByRecordNumber, parsePayload } from "../domain/payload.js";
import { enqueueJobs } from "../queue/redisQueue.js";
import { saveRawPatientRecords, type RecordSource } from "../repositories/rawRecords.js";

const INTEGER_PATTERN = /^-?\d+$/;
const RECORD_SOURCES: readonly RecordSource[] = ["upload", "api"];

export interface PublishedJob {
  record_number: string;
  job_id: string;
}

export interface PublishResult {
  batchId: string;
  publishedJobs: PublishedJob[];
}

/** The request was understood but is not acceptable; the message is safe to show the client. */
export class InvalidSubmissionError extends Error {}

export interface SubmissionQuery {
  model?: unknown;
  seed?: unknown;
  source?: unknown;
}

function parseSeed(rawSeed: unknown): number | undefined {
  if (rawSeed === undefined || rawSeed === "") return undefined;
  if (!INTEGER_PATTERN.test(String(rawSeed))) {
    throw new InvalidSubmissionError("Invalid 'seed': must be an integer");
  }
  return parseInt(String(rawSeed), 10);
}

/** Validates the whole batch, stores the submitted records, then queues one job per patient
 * record number. One invalid record rejects the batch, and nothing is queued if it cannot be stored. */
export async function submitBatch(
  rawText: string,
  query: SubmissionQuery,
  submittedBy: number | null,
): Promise<PublishResult> {
  const modelName = typeof query.model === "string" ? query.model : undefined;
  const source = RECORD_SOURCES.find((candidate) => candidate === query.source) ?? "api";
  const seed = parseSeed(query.seed);

  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    throw new InvalidSubmissionError("Empty or invalid request body");
  }

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
    { source, submittedBy, submittedAt: new Date().toISOString() },
  );

  await enqueueJobs(jobs);

  return { batchId, publishedJobs: jobs.map((job) => ({ record_number: job.record_number, job_id: job.job_id })) };
}
