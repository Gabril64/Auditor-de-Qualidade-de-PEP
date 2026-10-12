import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractAuditFields } from "../src/domain/auditFields.js";
import { applyConformity, countsOf, textFor } from "../src/domain/conformity.js";
import type { RawAuditResult } from "../src/transformer.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): RawAuditResult[] {
  return JSON.parse(
    readFileSync(path.resolve(here, `../../../tests/snapshots/${name}.json`), "utf8"),
  ) as RawAuditResult[];
}

const ALL = ["audit_ok_mix", "audit_all_null", "audit_timeout"].flatMap(fixture);

test("countsOf reproduces the global counters the Python audit computes, on every fixture record", () => {
  assert.equal(ALL.length, 48);
  for (const record of ALL) {
    const expected = record.audit_data?.conformity_global;
    assert.ok(expected);
    const counts = countsOf(extractAuditFields(record));
    assert.equal(counts.valid, expected.valid, record.record_id);
    assert.equal(counts.total, expected.total, record.record_id);
    assert.ok(Math.abs(counts.percent - (expected.percent ?? 0)) < 1e-9, record.record_id);
  }
});

test("applyConformity rewrites every section counter to what the Python audit produced", () => {
  for (const record of ALL) {
    const original = JSON.parse(JSON.stringify(record.audit_data)) as Record<string, unknown>;
    const copy = JSON.parse(JSON.stringify(record.audit_data)) as Record<string, unknown>;
    for (const key of Object.keys(copy)) if (key.startsWith("conformity_")) delete copy[key];
    // Sections that do not apply keep their counter, so start from the original for those.
    for (const key of ["conformity_c", "conformity_e"]) copy[key] = original[key];

    applyConformity(copy, extractAuditFields(record));

    for (const key of Object.keys(original).filter((name) => name.startsWith("conformity_"))) {
      const want = original[key] as { valid: number; total: number };
      const got = copy[key] as { valid: number; total: number };
      assert.equal(got.valid, want.valid, `${record.record_id} ${key} valid`);
      assert.equal(got.total, want.total, `${record.record_id} ${key} total`);
    }
  }
});

test("textFor keeps the 'conforme (…)' format", () => {
  assert.equal(textFor("conforme"), "conforme");
  assert.equal(textFor("conforme", "  ok  "), "conforme (ok)");
  assert.equal(textFor("nao_conforme", "falta a data"), "não conforme (falta a data)");
});
