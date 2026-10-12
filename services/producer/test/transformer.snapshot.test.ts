import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { transformAuditResult, type RawAuditResult } from "../src/transformer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(here, "../../../tests/snapshots");
const SNAPSHOTS_DIR = path.join(here, "snapshots");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

const FIXTURES = ["audit_ok_mix", "audit_all_null", "audit_timeout"];

function snapshotOf(fixture: string): unknown {
  const records = JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${fixture}.json`), "utf8")) as RawAuditResult[];
  return JSON.parse(JSON.stringify(records.map(transformAuditResult)));
}

for (const fixture of FIXTURES) {
  test(`transformAuditResult output stays frozen for ${fixture}`, () => {
    const actual = snapshotOf(fixture);
    const snapshotPath = path.join(SNAPSHOTS_DIR, `transformer_${fixture}.json`);

    if (UPDATE || !existsSync(snapshotPath)) {
      mkdirSync(SNAPSHOTS_DIR, { recursive: true });
      writeFileSync(snapshotPath, JSON.stringify(actual, null, 1) + "\n");
      return;
    }

    assert.deepEqual(actual, JSON.parse(readFileSync(snapshotPath, "utf8")));
  });
}

test("the front end gets three statuses: não conforme and não registrado both show as nao_conforme", () => {
  const result = transformAuditResult({
    record_id: "1",
    audit_data: {
      secao_a: {
        idade: "não conforme (Faltam: algo)",
        data_nascimento: "Não registrado (IA: null)",
        unidade_funcional: "Não se aplica",
        periodo_internacao: "conforme (IA: trecho)",
        diagnostico_internacao: "Ortopedia",
      },
    },
  });

  const items = "itens" in result.secoes[0] ? result.secoes[0].itens : [];
  const statusOf = (label: string) => items.find((item) => item.item === label)?.status;

  assert.equal(statusOf("Idade"), "nao_conforme");
  assert.equal(statusOf("Data de Nascimento"), "nao_conforme");
  assert.equal(statusOf("Unidade Funcional"), "nao_se_aplica");
  assert.equal(statusOf("Período de Internação"), "conforme");
  assert.equal(statusOf("Diagnóstico de Internação"), "conforme");
  assert.ok(result.nao_conformidades.some((nc) => nc.item === "Idade"));
});
