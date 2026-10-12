import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.SQLITE_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "producer-db-test-")), "auditor.db");

const { getAllAudits, getDashboardStats, upsertAuditResult } = await import("../src/repositories/audits.js");

function completedJob(overrides: Record<string, unknown> = {}) {
  return {
    batch_id: "batch-1",
    job_id: "job-1",
    record_number: "123",
    record_number_display: "1.23",
    encounter: "9",
    result: { record_id: "123", audit_data: { conformity_global: { valid: 8, total: 10, percent: 80 } } },
    ...overrides,
  };
}

test("upsertAuditResult inserts a new row readable through getAllAudits", () => {
  assert.equal(upsertAuditResult(completedJob()), true);
  const audits = getAllAudits();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].job_id, "job-1");
  assert.equal(audits[0].conformity_percent, 80);
});

test("upsertAuditResult updates the same row on a repeated job_id, instead of duplicating it", () => {
  upsertAuditResult(completedJob({ job_id: "job-2" }));
  upsertAuditResult(
    completedJob({
      job_id: "job-2",
      result: { record_id: "123", audit_data: { conformity_global: { valid: 10, total: 10, percent: 100 } } },
    }),
  );
  const audits = getAllAudits().filter((a) => a.job_id === "job-2");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].conformity_percent, 100);
});

test("getDashboardStats reflects the rows written by upsertAuditResult", () => {
  const stats = getDashboardStats();
  assert.ok(stats.total_audits >= 2);
});
