import assert from "node:assert/strict";
import { test } from "node:test";
import { applyConformity } from "../src/domain/conformity.js";
import { extractAuditFields, writeFieldText } from "../src/domain/auditFields.js";
import { annotateItemRefs } from "../src/domain/itemRefs.js";
import { transformAuditResult, type RawAuditResult } from "../src/transformer.js";

/** An audit with two other professional categories, as `data_extract` writes section E. */
function teamAudit(): RawAuditResult {
  return {
    record_id: "1",
    audit_data: {
      secao_e: {
        tem_outras_categorias: true,
        categorias: {
          "Serviço Social": { anamnese: "conforme", evolucao: "Não se aplica" },
          Psicologia: { anamnese: "Não se aplica", evolucao: "Não se aplica" },
        },
      },
      conformity_e: { valid: 1, total: 1 },
    },
  } as unknown as RawAuditResult;
}

test("section E shows each category as a title, with anamnese and evolução inside", () => {
  const section = transformAuditResult(teamAudit()).secoes.find((s) => s.id === "E");
  assert.ok(section && "subgrupos" in section);

  assert.deepEqual(
    section.subgrupos.map((group) => [group.titulo, group.itens.map((item) => [item.item, item.status])]),
    [
      ["Serviço Social", [["Anamnese", "conforme"], ["Evolução", "nao_se_aplica"]]],
      ["Psicologia", [["Anamnese", "nao_se_aplica"], ["Evolução", "nao_se_aplica"]]],
    ],
  );
});

test("section E rows are one per category and record type, the category being the field", () => {
  const rows = extractAuditFields(teamAudit()).filter((row) => row.section === "E");

  assert.deepEqual(
    rows.map((row) => [row.record_type, row.field, row.status]),
    [
      ["anamnesis", "Serviço Social", "conforme"],
      ["evolution", "Serviço Social", "nao_se_aplica"],
      ["anamnesis", "Psicologia", "nao_se_aplica"],
      ["evolution", "Psicologia", "nao_se_aplica"],
    ],
  );
});

test("each item of section E carries the ref the edit screen sends back", () => {
  const source = teamAudit();
  const audit = annotateItemRefs(transformAuditResult(source), source);
  const section = audit.secoes.find((s) => s.id === "E");
  assert.ok(section && "subgrupos" in section);

  assert.deepEqual(section.subgrupos[0]?.itens[1]?.ref, { section: "E", record_type: "evolution", field: "Serviço Social" });
  assert.deepEqual(section.subgrupos[1]?.itens[0]?.ref, { section: "E", record_type: "anamnesis", field: "Psicologia" });
});

test("an edit of a section E item lands under its category and record type, and the score follows", () => {
  const audit = (teamAudit().audit_data ?? {}) as unknown as Record<string, unknown>;

  writeFieldText(audit, "E", "evolution", "Serviço Social", "não conforme (sem evolução do caso)");

  const categories = (audit["secao_e"] as { categorias: Record<string, Record<string, string>> }).categorias;
  assert.equal(categories["Serviço Social"]?.evolucao, "não conforme (sem evolução do caso)");
  assert.equal(categories["Serviço Social"]?.anamnese, "conforme");

  const counts = applyConformity(audit, extractAuditFields({ record_id: "1", audit_data: audit } as unknown as RawAuditResult));
  assert.deepEqual([counts.valid, counts.total], [1, 2], "not applicable cells stay out of the total");
  assert.deepEqual((audit["conformity_e"] as { valid: number; total: number }).total, 2);
});

test("an audit stored before the split still shows section E as one item", () => {
  const legacy = {
    record_id: "1",
    audit_data: { secao_e: { tem_outras_categorias: true, categoria: "FISIO", descricao: "conforme" }, conformity_e: { valid: 1, total: 1 } },
  } as unknown as RawAuditResult;

  const section = transformAuditResult(legacy).secoes.find((s) => s.id === "E");
  assert.ok(section && "itens" in section);
  assert.deepEqual(section.itens.map((item) => item.item), ["Categoria", "Descrição"]);
});

test("section E is always shown: with no other category it lists social service and psychology, all not applicable", () => {
  const noTeam = {
    record_id: "1",
    audit_data: {
      secao_e: {
        tem_outras_categorias: false,
        categorias: {
          "Serviço Social": { anamnese: "Não se aplica", evolucao: "Não se aplica" },
          Psicologia: { anamnese: "Não se aplica", evolucao: "Não se aplica" },
        },
      },
      conformity_e: { valid: 0, total: 0 },
    },
  } as unknown as RawAuditResult;

  const section = transformAuditResult(noTeam).secoes.find((s) => s.id === "E");
  assert.ok(section && "subgrupos" in section);
  assert.deepEqual(section.subgrupos.map((group) => group.titulo), ["Serviço Social", "Psicologia"]);
  assert.ok(section.subgrupos.every((group) => group.itens.every((item) => item.status === "nao_se_aplica")));
  assert.equal(section.conformidade, 100);
});

test("quantitativo: other categories get a row per record type only when they have records", () => {
  const withTeam = {
    record_id: "1",
    audit_data: {
      matriz_documentos: {
        datas: ["15/03/2024", "16/03/2024"],
        matriz: {
          "MEDICINA - Anamnese": { "15/03/2024": 1 },
          "Serviço Social - Anamnese": { "15/03/2024": 1 },
          "Fisioterapia/Terapia Ocupacional - Evolução": { "16/03/2024": 2 },
        },
      },
      secao_e: {
        tem_outras_categorias: true,
        categorias: {
          "Fisioterapia/Terapia Ocupacional": { anamnese: "Não se aplica", evolucao: "conforme" },
          Psicologia: { anamnese: "Não se aplica", evolucao: "Não se aplica" },
          "Serviço Social": { anamnese: "Não registrado", evolucao: "Não se aplica" },
        },
      },
    },
  } as unknown as RawAuditResult;

  const rows = transformAuditResult(withTeam).quantitativo;
  assert.deepEqual(
    rows.map((row) => row.tipo),
    [
      "Anamnese Médica", "Anamnese Enfermagem", "Evolução Médica", "Evolução Enfermagem",
      "Evolução Fisioterapia/Terapia Ocupacional", "Anamnese Serviço Social",
    ],
  );
  const physio = rows.find((row) => row.tipo === "Evolução Fisioterapia/Terapia Ocupacional");
  assert.deepEqual([physio?.["15/03"], physio?.["16/03"], physio?.total, physio?.conformidade], [false, true, 1, 100]);
  assert.equal(rows.find((row) => row.tipo === "Anamnese Serviço Social")?.conformidade, 0);
});

test("quantitativo: without records of other categories only medicine and nursing are listed", () => {
  const rows = transformAuditResult(teamAudit()).quantitativo;
  assert.deepEqual(rows.map((row) => row.tipo), ["Anamnese Médica", "Anamnese Enfermagem", "Evolução Médica", "Evolução Enfermagem"]);
});

test("quantitativo: audits whose dates were stored without zero padding still show each day", () => {
  const result = transformAuditResult({
    record_id: "1",
    audit_data: {
      matriz_documentos: {
        datas: ["3/12/2023", "4/12/2023", "5/12/2023"],
        matriz: { "MEDICINA - Anamnese": { "3/12/2023": 1 }, "MEDICINA - Evolução": { "4/12/2023": 1, "5/12/2023": 1 } },
      },
    },
  } as unknown as RawAuditResult);

  assert.deepEqual(result.days, ["03/12", "04/12", "05/12"]);
  const anamnesis = result.quantitativo.find((row) => row.tipo === "Anamnese Médica");
  const evolution = result.quantitativo.find((row) => row.tipo === "Evolução Médica");
  assert.deepEqual([anamnesis?.["03/12"], anamnesis?.total], [true, 1]);
  assert.deepEqual([evolution?.["04/12"], evolution?.["05/12"], evolution?.total], [true, true, 2]);
});
