import { errorMessage } from "../errorMessage.js";
import { getAllAudits, getAuditById, type AuditRecord } from "../repositories/audits.js";
import { getRawPatientRecordByJobId } from "../repositories/rawRecords.js";
import { transformAuditResult } from "../transformer.js";

function toAuditSummary(audit: AuditRecord) {
  const summary = {
    id: audit.id,
    record_number: audit.record_number,
    record_number_display: audit.record_number_display,
    conformity_percent: audit.conformity_percent,
    created_at: audit.created_at,
    status: audit.status,
  };

  try {
    return {
      ...summary,
      batch_id: audit.batch_id,
      job_id: audit.job_id,
      encounter: audit.encounter,
      audit: transformAuditResult(audit.audit_data),
    };
  } catch (error) {
    console.error(`Error transforming audit ${audit.id}:`, errorMessage(error));
    return { ...summary, audit: null, error: "Transform failed" };
  }
}

export function listAuditSummaries() {
  const audits = getAllAudits().map(toAuditSummary);
  return { audits, total: audits.length };
}

/** One audit with its transformed result, the original result and the stored submission; null when unknown. */
export function getAuditDetail(id: number) {
  const audit = getAuditById(id);
  if (!audit) return null;

  return {
    id: audit.id,
    record_number: audit.record_number,
    record_number_display: audit.record_number_display,
    encounter: audit.encounter,
    conformity_percent: audit.conformity_percent,
    created_at: audit.created_at,
    audit: transformAuditResult(audit.audit_data),
    raw: audit.audit_data,
    raw_patient_record: getRawPatientRecordByJobId(audit.job_id),
  };
}
