import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.SQLITE_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "producer-raw-test-")), "auditor.db");

const { RAW_RECORD_COLUMNS } = await import("../src/domain/rawRecordColumns.js");
const { getRawPatientRecordByJobId, saveRawPatientRecords } = await import("../src/repositories/rawRecords.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(
  readFileSync(path.resolve(here, "../../../tests/fixtures/prontuarios_sample.json"), "utf8"),
) as Record<string, unknown>[];

const SUBMISSION = { source: "api" as const, submittedBy: null, submittedAt: "2026-10-12T10:00:00.000Z" };

function input(jobId: string, records: Record<string, unknown>[]) {
  return { jobId, batchId: "batch-raw", recordNumber: "123", recordNumberDisplay: "1.23", records };
}

test("every key of the synthetic records has a column, so none is dropped silently", () => {
  const mapped = new Set(RAW_RECORD_COLUMNS.map(([key]) => key));
  const unmapped = new Set<string>();
  for (const record of sample) {
    for (const key of Object.keys(record)) if (!mapped.has(key)) unmapped.add(key);
  }
  assert.deepEqual([...unmapped], []);
  assert.equal(RAW_RECORD_COLUMNS.length, 24);
});

test("saves each entry with one column per key and the original JSON untouched", () => {
  const records = sample.slice(0, 3);
  saveRawPatientRecords([input("job-a", records)], SUBMISSION);

  const stored = getRawPatientRecordByJobId("job-a");
  assert.ok(stored);
  assert.equal(stored.batch_id, "batch-raw");
  assert.equal(stored.source, "api");
  assert.equal(stored.submitted_by, null);
  assert.equal(stored.submitted_at, SUBMISSION.submittedAt);
  assert.equal(stored.entries.length, 3);

  stored.entries.forEach((entry, index) => {
    assert.equal(entry.position, index);
    assert.deepEqual(entry.original, records[index]);
    assert.equal(entry.extra_keys, null);
    assert.equal(entry.fields.entry_description, records[index]["Descricao do registro"] ?? null);
    assert.equal(entry.fields.anamnesis_created_at, records[index]["criacao_anamnsese"] ?? null);
  });
});

test("the same content gives the same sha256, a different content does not", () => {
  saveRawPatientRecords([input("job-b1", sample.slice(0, 2)), input("job-b2", sample.slice(0, 2))], SUBMISSION);
  saveRawPatientRecords([input("job-b3", sample.slice(2, 4))], SUBMISSION);

  const [b1, b2, b3] = ["job-b1", "job-b2", "job-b3"].map((jobId) => getRawPatientRecordByJobId(jobId));
  assert.ok(b1 && b2 && b3);
  assert.equal(b1.sha256, b2.sha256);
  assert.notEqual(b1.sha256, b3.sha256);
});

test("keeps keys without a column in extra_keys, numbers as text, empty text empty and null as null", () => {
  saveRawPatientRecords(
    [input("job-c", [{ Prontuário: 4455, Sexo: "", Atendimento: null, "Chave Nova": "valor" }])],
    SUBMISSION,
  );

  const stored = getRawPatientRecordByJobId("job-c");
  assert.ok(stored);
  const [entry] = stored.entries;
  assert.equal(entry.fields.record_number, "4455");
  assert.equal(entry.fields.sex, "");
  assert.equal(entry.fields.encounter, null);
  assert.deepEqual(entry.extra_keys, { "Chave Nova": "valor" });
  assert.equal(entry.original["Prontuário"], 4455);
});

test("a failure while saving stores nothing from the batch", () => {
  saveRawPatientRecords([input("job-d1", sample.slice(0, 1))], SUBMISSION);

  assert.throws(() =>
    saveRawPatientRecords([input("job-d2", sample.slice(1, 2)), input("job-d1", sample.slice(2, 3))], SUBMISSION),
  );
  assert.equal(getRawPatientRecordByJobId("job-d2"), null);
});

test("a job id that was never stored has no raw record", () => {
  assert.equal(getRawPatientRecordByJobId("job-unknown"), null);
});
