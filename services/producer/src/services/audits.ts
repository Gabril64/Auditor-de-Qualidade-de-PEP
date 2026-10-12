import { approvalStateOf } from "../domain/approvals.js";
import { annotateItemRefs } from "../domain/itemRefs.js";
import { errorMessage } from "../errorMessage.js";
import { getAllAudits, getAuditById, getAuditFields, type AuditRecord } from "../repositories/audits.js";
import { listApprovalEvents, listHistory } from "../repositories/history.js";
import { getRawPatientRecordByJobId } from "../repositories/rawRecords.js";
import { getRevision, getRevisionFields } from "../repositories/revisions.js";
import type { UserRow } from "../repositories/users.js";
import { transformAuditResult } from "../transformer.js";
import { contentVersionOf } from "./revisions.js";

function toAuditSummary(audit: AuditRecord, approval: ReturnType<typeof approvalStateOf>) {
  const summary = {
    id: audit.id,
    record_number: audit.record_number,
    record_number_display: audit.record_number_display,
    conformity_percent: audit.conformity_percent,
    created_at: audit.created_at,
    status: audit.status,
  };
  const review = {
    edited: audit.revised_by !== null && audit.revised_by !== undefined,
    deleted_at: audit.deleted_at ?? null,
    approval_status: approval.status,
    approved_by: approval.approved_by,
  };

  try {
    return {
      ...summary,
      ...review,
      batch_id: audit.batch_id,
      job_id: audit.job_id,
      encounter: audit.encounter,
      audit: transformAuditResult(audit.audit_data),
    };
  } catch (error) {
    console.error(`Error transforming audit ${audit.id}:`, errorMessage(error));
    return { ...summary, ...review, audit: null, error: "Transform failed" };
  }
}

/** The audits with their current version. An administrator may ask for the deleted ones instead. */
export function listAuditSummaries(user: UserRow, onlyDeleted = false) {
  const records = getAllAudits(onlyDeleted && user.role === "admin");
  const events = listApprovalEvents(records.map((record) => record.id));

  const audits = records.map((record) => {
    const ownEvents = events.filter((event) => event.audit_id === record.id);
    const version = record.revised_by != null ? (record.revised_at ?? null) : null;
    return toAuditSummary(record, approvalStateOf(ownEvents, version));
  });
  return { audits, total: audits.length };
}

/** One audit with the original, the current version, the submission, approvals and history;
 * null when unknown, or deleted and the user is not an administrator. */
export function getAuditDetail(id: number, user: UserRow) {
  const audit = getAuditById(id);
  if (!audit) return null;

  const revision = getRevision(id);
  if (revision?.deleted_at && user.role !== "admin") return null;

  const version = contentVersionOf(revision);
  const approval = approvalStateOf(listApprovalEvents([id]), version);
  const revised = revision && version ? (JSON.parse(revision.audit_data) as typeof audit.audit_data) : null;
  const current = revised ?? audit.audit_data;

  return {
    id: audit.id,
    record_number: audit.record_number,
    record_number_display: audit.record_number_display,
    encounter: audit.encounter,
    conformity_percent: revised ? (revision?.conformity_percent ?? audit.conformity_percent) : audit.conformity_percent,
    original_conformity_percent: audit.original_conformity_percent,
    created_at: audit.created_at,
    audit: annotateItemRefs(transformAuditResult(current), current),
    raw: audit.audit_data,
    fields: getAuditFields(audit.id),
    revised_audit: revised,
    revised_fields: revised ? getRevisionFields(id) : [],
    updated_at: version,
    deleted_at: revision?.deleted_at ?? null,
    raw_patient_record: getRawPatientRecordByJobId(audit.job_id),
    approval_status: approval.status,
    approved_by: approval.approved_by,
    approved_before_edit_by: approval.approved_before_edit_by,
    approved_by_me: approval.approvedUserIds.includes(user.id),
    history: listHistory(id),
  };
}
