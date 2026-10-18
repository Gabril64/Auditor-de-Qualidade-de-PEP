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

test("quantitativo: each document type is scored by its own conformity count, not by being present", () => {
  const result = transformAuditResult({
    record_id: "1",
    audit_data: {
      matriz_documentos: {
        datas: ["15/03/2024", "16/03/2024"],
        matriz: { "MEDICINA - Anamnese": { "15/03/2024": 1 }, "ENFERMAGEM - Evolução": { "16/03/2024": 2 } },
      },
      conformity_b_anamnese: { valid: 6, total: 8 },
      conformity_d_evolucao: { valid: 3, total: 7 },
      conformity_b_evolucao: { valid: 0, total: 0 },
    },
  });
  const byType = Object.fromEntries(result.quantitativo.map((row) => [row.tipo, row]));

  assert.equal(byType["Anamnese Médica"]?.conformidade, 75);
  assert.equal(byType["Evolução Enfermagem"]?.conformidade, 42.9);
  assert.equal(byType["Anamnese Médica"]?.total, 1);
  assert.equal(byType["Serviço Social"], undefined, "a category without records has no row");
});

test("quantitativo: the same day and month in another year is not the same day", () => {
  const result = transformAuditResult({
    record_id: "1",
    audit_data: {
      matriz_documentos: {
        datas: ["15/03/2023", "15/03/2024"],
        matriz: { "MEDICINA - Anamnese": { "15/03/2024": 1 } },
      },
    },
  });
  const row = result.quantitativo.find((r) => r.tipo === "Anamnese Médica");

  assert.equal(row?.total, 1);
});
