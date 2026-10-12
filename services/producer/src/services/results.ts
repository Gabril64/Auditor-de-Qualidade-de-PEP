import { inTransaction } from "../db/connection.js";
import { errorMessage } from "../errorMessage.js";
import { findAuditIdByJob, upsertAuditResult, type CompletedJob } from "../repositories/audits.js";
import {
  insertNotifications,
  purgeReadBefore,
  recipientsOf,
  type NewNotification,
  type NotificationType,
} from "../repositories/notifications.js";

const RETENTION_DAYS = 30;

interface Outcome {
  type: NotificationType;
  detail: string | null;
}

function outcomeOf(job: CompletedJob): Outcome {
  const result = job.result as { _job_failed?: boolean; attempts?: number; audit_data?: { ia_incompleta?: boolean } };

  if (result._job_failed === true) {
    return { type: "audit_failed", detail: `Falha no processamento após ${result.attempts ?? "várias"} tentativas` };
  }
  if (result.audit_data?.ia_incompleta) {
    return { type: "audit_partial", detail: "A IA não respondeu em alguns campos" };
  }
  return { type: "audit_done", detail: null };
}

/** Persists a finished job and notifies the people concerned, in one transaction. A job that
 * failed for good is not an audit: it only notifies. Returns false when nothing was committed, so
 * the caller leaves the message to be retried. */
export function recordJobOutcome(job: CompletedJob): boolean {
  const outcome = outcomeOf(job);
  const jobId = job.job_id ?? "unknown";

  try {
    inTransaction(() => {
      if (outcome.type !== "audit_failed" && !upsertAuditResult(job)) {
        throw new Error("could not store the audit result");
      }

      const notification: NewNotification = {
        type: outcome.type,
        jobId,
        batchId: job.batch_id ?? null,
        auditId: outcome.type === "audit_failed" ? null : findAuditIdByJob(jobId),
        recordNumberDisplay: job.record_number_display ?? job.record_number ?? null,
        detail: outcome.detail,
      };
      insertNotifications(recipientsOf(jobId), notification, new Date().toISOString());
    });
    return true;
  } catch (error) {
    console.error(`[Results] Could not record the outcome of job ${jobId}:`, errorMessage(error));
    return false;
  }
}

/** Removes the notifications read more than 30 days ago. */
export function purgeOldNotifications(now = Date.now()): number {
  const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return purgeReadBefore(cutoff);
}
