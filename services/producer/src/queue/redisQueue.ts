import { createClient } from "redis";
import type { QueuedJob } from "../domain/payload.js";
import type { RawAuditResult } from "../transformer.js";

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
