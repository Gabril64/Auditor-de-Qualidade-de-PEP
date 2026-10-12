import { readStoredResult, type StoredResult } from "../queue/redisQueue.js";
import { transformAuditResult } from "../transformer.js";

export type JobStatus = "processing" | "failed" | "partial" | "done";

/** What a status route answers: `pending` is true while there is no result yet. */
export interface StatusReply {
  pending: boolean;
  body: Record<string, unknown>;
}

/** Derives the job state from what is stored: processing, failed, partial (AI did not run on every field) or done. */
export function jobStatusOf(result: StoredResult | null): JobStatus {
  if (!result) return "processing";
  if (result._job_failed) return "failed";
  if (result.audit_data?.ia_incompleta) return "partial";
  return "done";
}

export async function getRecordStatus(recordNumber: string): Promise<StatusReply> {
  const result = await readStoredResult(recordNumber);

  if (!result) {
    return { pending: true, body: { status: "processing", record_number: recordNumber } };
  }

  return { pending: false, body: { status: "done", result: transformAuditResult(result), raw: result } };
}

export async function getJobStatus(jobId: string): Promise<StatusReply> {
  const result = await readStoredResult(jobId);

  if (!result) {
    return { pending: true, body: { status: "processing", job_id: jobId } };
  }

  if (result._job_failed) {
    return {
      pending: false,
      body: { status: "failed", job_id: jobId, error: result.error, attempts: result.attempts },
    };
  }

  return {
    pending: false,
    body: { status: jobStatusOf(result), result: transformAuditResult(result), raw: result },
  };
}
