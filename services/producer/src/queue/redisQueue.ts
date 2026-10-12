import type { QueuedJob } from "../domain/payload.js";
import { redis } from "./redisClient.js";
import type { RawAuditResult } from "../transformer.js";

export interface StoredResult extends RawAuditResult {
  _job_failed?: boolean;
  error?: string;
  attempts?: number;
  audit_data?: NonNullable<RawAuditResult["audit_data"]> & { ia_incompleta?: boolean };
}

const QUEUE_KEY = "fila:prontuarios";
const RESULT_KEY_PREFIX = "resultado:";

/** Pushes the jobs onto the audit queue, in order. */
export async function enqueueJobs(jobs: QueuedJob[]): Promise<void> {
  for (const job of jobs) {
    await redis.lPush(QUEUE_KEY, JSON.stringify(job));
  }
}

/** Reads a finished result by job id or by record number; null while it is still processing. */
export async function readStoredResult(id: string): Promise<StoredResult | null> {
  const value = await redis.get(`${RESULT_KEY_PREFIX}${id}`);
  return value ? (JSON.parse(value) as StoredResult) : null;
}
