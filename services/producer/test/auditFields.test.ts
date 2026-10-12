import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { RawAuditResult } from "../src/transformer.js";

process.env.SQLITE_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "producer-fields-test-")), "auditor.db");

const { extractAuditFields, statusOf } = await import("../src/domain/auditFields.js");
const { getAuditFields, upsertAuditResult } = await import("../src/repositories/audits.js");
const { migrate } = await import("../src/db/migrate.js");

const here = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): RawAuditResult[] {
  return JSON.parse(
    readFileSync(path.resolve(here, `../../../tests/snapshots/${name}.json`), "utf8"),
  ) as RawAuditResult[];
}

const FIXTURES = ["audit_ok_mix", "audit_all_null", "audit_timeout"];

function find(rows: ReturnType<typeof extractAuditFields>, section: string, recordType: string | null, field: string) {
  const row = rows.find((r) => r.section === section && r.record_type === recordType && r.field === field);
  assert.ok(row, `${section}/${recordType}/${field} not found`);
  return row;
}

test("statusOf reads the four statuses the conformity score distinguishes", () => {
  assert.equal(statusOf("conforme"), "conforme");
  assert.equal(statusOf("conforme (IA: trecho)"), "conforme");
  assert.equal(statusOf("Ortopedia"), "conforme");
  assert.equal(statusOf(true), "conforme");
  assert.equal(statusOf("não conforme (Faltam: Respiratório)"), "nao_conforme");
  assert.equal(statusOf("Incompleto (IA)"), "nao_conforme");
  assert.equal(statusOf("false"), "nao_conforme");
  assert.equal(statusOf(false), "nao_conforme");
  assert.equal(statusOf("Não registrado (IA: null)"), "nao_registrado");
  assert.equal(statusOf(""), "nao_registrado");
  assert.equal(statusOf(null), "nao_registrado");
  assert.equal(statusOf("Não se aplica"), "nao_se_aplica");
  assert.equal(statusOf("N/A"), "nao_se_aplica");
});

test("fields carry section, record type, status and the source taken from _ia_meta", () => {
  const rows = extractAuditFields(fixture("audit_ok_mix")[0]);

  assert.deepEqual(find(rows, "A", null, "prontuario"), {
    section: "A",
    record_type: null,
    field: "prontuario",
    value: rows.find((r) => r.field === "prontuario")?.value,
    status: "conforme",
    source: "rule",
  });
  assert.equal(find(rows, "C", null, "descricao_tecnica").status, "nao_registrado");
  assert.equal(find(rows, "C", null, "descricao_tecnica").source, "ai_null");
  assert.equal(find(rows, "D", "evolution", "condutas").status, "nao_conforme");
  assert.equal(find(rows, "D", "evolution", "condutas").source, "ai");
  assert.equal(find(rows, "D", "evolution", "exame_fisico").source, "rule");
  assert.equal(find(rows, "B", "evolution", "hd_cid").source, "ai");
  assert.equal(find(rows, "B", "anamnesis", "hd_cid").record_type, "anamnesis");
});

test("a field the AI call failed on is ai_failed", () => {
  const rows = extractAuditFields(fixture("audit_timeout")[0]);
  assert.equal(find(rows, "B", "anamnesis", "hda").source, "ai_failed");
});

test("fields reproduce the conformity score of the system, on every fixture record", () => {
  let checked = 0;
  for (const name of FIXTURES) {
    for (const record of fixture(name)) {
      const rows = extractAuditFields(record);
      const global = record.audit_data?.conformity_global;
      assert.ok(global);

      const conforming = rows.filter((row) => row.status === "conforme").length;
      const applicable = rows.filter((row) => row.status !== "nao_se_aplica").length;
      assert.equal(conforming, global.valid, `${name} ${record.record_id}: valid`);
      assert.equal(applicable, global.total, `${name} ${record.record_id}: total`);
      checked++;
    }
  }
  assert.equal(checked, 48);
});

test("section C and E are left out when they do not apply to the record", () => {
  const records = fixture("audit_ok_mix");
  const withoutSurgery = records.find((record) => record.audit_data?.secao_c?.tem_cirurgia === false);
  assert.ok(withoutSurgery);
  assert.equal(extractAuditFields(withoutSurgery).filter((row) => row.section === "C").length, 0);

  const withoutTeam = records.find((record) => record.audit_data?.secao_e?.tem_outras_categorias === false);
  assert.ok(withoutTeam);
  assert.equal(extractAuditFields(withoutTeam).filter((row) => row.section === "E").length, 0);
});

test("upsertAuditResult stores the fields with the audit, and a repeated job_id replaces them", () => {
  const record = fixture("audit_ok_mix")[0];
  const job = { batch_id: "b", job_id: "job-fields", record_number: "1", record_number_display: "1", result: record };

  assert.equal(upsertAuditResult(job), true);
  assert.equal(upsertAuditResult(job), true);

  const db = new Database(process.env.SQLITE_DB_PATH as string);
  const { id } = db.prepare("SELECT id FROM audit_results WHERE job_id = 'job-fields'").get() as { id: number };
  db.close();

  assert.deepEqual(getAuditFields(id), extractAuditFields(record));
});

test("migrate fills the fields of audits stored before the table existed", () => {
  const db = new Database(":memory:");
  migrate(db);
  const record = fixture("audit_ok_mix")[1];
  db.prepare(
    `INSERT INTO audit_results (batch_id, job_id, record_number, audit_data, created_at)
     VALUES ('b', 'old-job', '1', ?, '2026-01-01T00:00:00.000Z')`,
  ).run(JSON.stringify(record));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM audit_fields").get() as { n: number }).n, 0);

  migrate(db);
  const stored = db.prepare("SELECT COUNT(*) AS n FROM audit_fields").get() as { n: number };
  assert.equal(stored.n, extractAuditFields(record).length);

  migrate(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM audit_fields").get() as { n: number }).n, stored.n);
  db.close();
});
