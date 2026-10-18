import { inTransaction } from "../db/connection.js";
import { approvalStateOf, type ApprovalState } from "../domain/approvals.js";
import { applyConformity, textFor } from "../domain/conformity.js";
import { sectionKeyOf, statusOf, writeFieldText, type RecordType } from "../domain/auditFields.js";
import { HttpError } from "../errors.js";
import { getAuditById } from "../repositories/audits.js";
import { addHistory, listApprovalEvents } from "../repositories/history.js";
import {
  createRevision,
  getRevision,
  getRevisionFields,
  setRevisionDeleted,
  updateRevisionField,
  updateRevisionJson,
  type RevisionRow,
} from "../repositories/revisions.js";
import type { UserRow } from "../repositories/users.js";

type Json = Record<string, unknown>;

export interface FieldChange {
  section: string;
  record_type: RecordType | null;
  field: string;
  status: "conforme" | "nao_conforme";
  comment?: string;
}

/** The version label of the current content: the time of the last human edit, or null when nobody
 * has edited the audit (a revision created only to hide it does not change the content). */
export function contentVersionOf(revision: RevisionRow | null): string | null {
  return revision && revision.updated_by !== null ? revision.updated_at : null;
}

function requireAudit(auditId: number) {
  const audit = getAuditById(auditId);
  if (!audit) throw new HttpError(404, "Audit not found");
  return audit;
}

function requireLive(auditId: number) {
  const audit = requireAudit(auditId);
  if (getRevision(auditId)?.deleted_at) throw new HttpError(404, "Audit not found");
  return audit;
}

/** A version label that always moves forward, even for two saves in the same millisecond. */
function nextVersion(current: string | null): string {
  const now = new Date();
  if (current && now.toISOString() <= current) return new Date(new Date(current).getTime() + 1).toISOString();
  return now.toISOString();
}

function ensureRevision(auditId: number, now: string): RevisionRow {
  const existing = getRevision(auditId);
  if (existing) return existing;

  const audit = requireAudit(auditId);
  createRevision(auditId, JSON.stringify(audit.audit_data), audit.original_conformity_percent ?? 0, now);
  return getRevision(auditId) as RevisionRow;
}

function parseChanges(input: unknown): FieldChange[] {
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, "'changes' must be a non-empty list");

  return input.map((item, index) => {
    const change = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const where = `change ${index + 1}`;
    if (typeof change.section !== "string" || typeof change.field !== "string") {
      throw new HttpError(400, `${where}: 'section' and 'field' are required`);
    }
    if (change.status !== "conforme" && change.status !== "nao_conforme") {
      throw new HttpError(400, `${where}: 'status' must be 'conforme' or 'nao_conforme'`);
    }
    if (change.comment !== undefined && typeof change.comment !== "string") {
      throw new HttpError(400, `${where}: 'comment' must be text`);
    }
    const recordType = change.record_type ?? null;
    if (recordType !== null && recordType !== "anamnesis" && recordType !== "evolution") {
      throw new HttpError(400, `${where}: invalid 'record_type'`);
    }
    return {
      section: change.section,
      record_type: recordType,
      field: change.field,
      status: change.status,
      comment: change.comment,
    };
  });
}

/** Saves the auditor's changes into the current version, never into the original. `seenVersion`
 * is the `updated_at` the auditor was looking at (null if there was no revision yet); if somebody
 * saved in between, the save is refused with 409. Returns the new version. */
export function editAudit(auditId: number, seenVersion: unknown, changesInput: unknown, user: UserRow): string {
  const changes = parseChanges(changesInput);
  if (seenVersion !== null && seenVersion !== undefined && typeof seenVersion !== "string") {
    throw new HttpError(400, "'updated_at' must be text or null");
  }

  return inTransaction(() => {
    requireLive(auditId);
    const currentVersion = contentVersionOf(getRevision(auditId));
    if ((seenVersion ?? null) !== currentVersion) {
      throw new HttpError(409, "The audit was changed by someone else; reload it before saving");
    }

    const now = new Date().toISOString();
    const revision = ensureRevision(auditId, now);
    const version = nextVersion(currentVersion);
    const fields = getRevisionFields(auditId);
    const data = JSON.parse(revision.audit_data) as Json;
    const audit = (data.audit_data as Json | undefined) ?? data;

    for (const change of changes) {
      const field = fields.find(
        (row) => row.section === change.section && row.record_type === change.record_type && row.field === change.field,
      );
      const key = sectionKeyOf(change.section, change.record_type);
      if (!field || !key) throw new HttpError(400, `Unknown field: ${change.section}/${change.field}`);

      const text = textFor(change.status, change.comment);
      addHistory({
        auditId,
        action: "field_edit",
        userId: user.id,
        createdAt: version,
        section: field.section,
        recordType: field.record_type,
        field: field.field,
        oldValue: field.value,
        newValue: text,
        oldStatus: field.status,
        newStatus: change.status,
      });

      writeFieldText(audit, change.section, change.record_type, change.field, text);
      field.value = text;
      field.status = statusOf(text);
      updateRevisionField(auditId, field, version, user.id);
    }

    const global = applyConformity(audit, fields);
    updateRevisionJson(auditId, JSON.stringify(data), global.percent, version, user.id);
    return version;
  });
}

export function approveAudit(auditId: number, user: UserRow): void {
  inTransaction(() => {
    requireLive(auditId);
    const version = contentVersionOf(getRevision(auditId));
    if (currentApproval(auditId, version).approvedUserIds.includes(user.id)) return;
    addHistory({
      auditId,
      action: "approve",
      userId: user.id,
      createdAt: new Date().toISOString(),
      revisionVersion: version,
    });
  });
}

/** Withdraws the user's own approval; a no-op when they have no standing approval. */
export function revokeApproval(auditId: number, user: UserRow): void {
  inTransaction(() => {
    requireLive(auditId);
    const events = listApprovalEvents([auditId]).filter((event) => event.user_id === user.id);
    if (events.at(-1)?.action !== "approve") return;
    addHistory({ auditId, action: "revoke_approval", userId: user.id, createdAt: new Date().toISOString() });
  });
}

/** Logical delete: the audit disappears from the lists, and an administrator can restore it. */
export function deleteAudit(auditId: number, user: UserRow): void {
  inTransaction(() => {
    requireLive(auditId);
    const now = new Date().toISOString();
    ensureRevision(auditId, now);
    setRevisionDeleted(auditId, now, user.id);
    addHistory({ auditId, action: "delete", userId: user.id, createdAt: now });
  });
}

export function restoreAudit(auditId: number, user: UserRow): void {
  inTransaction(() => {
    requireAudit(auditId);
    if (!getRevision(auditId)?.deleted_at) throw new HttpError(409, "The audit is not deleted");
    setRevisionDeleted(auditId, null, null);
    addHistory({ auditId, action: "restore", userId: user.id, createdAt: new Date().toISOString() });
  });
}

export function currentApproval(auditId: number, version: string | null): ApprovalState {
  return approvalStateOf(listApprovalEvents([auditId]), version);
}
