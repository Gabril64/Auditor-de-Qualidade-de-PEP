import type { RawAuditResult } from "../transformer.js";

export type FieldStatus = "conforme" | "nao_conforme" | "nao_registrado" | "nao_se_aplica";
export type FieldSource = "rule" | "ai" | "ai_null" | "ai_failed";
export type RecordType = "anamnesis" | "evolution";

export interface AuditFieldRow {
  section: string;
  record_type: RecordType | null;
  field: string;
  value: string | null;
  status: FieldStatus;
  source: FieldSource;
}

interface SectionSpec {
  key: string;
  section: string;
  recordType: RecordType | null;
  fields: string[];
  onlyWhen?: string;
}

/** The fields that count toward conformity, per section. Section C is audited only when there was
 * surgery and section E only when there are other professional categories, as in the conformity score. */
const SECTIONS: SectionSpec[] = [
  {
    key: "secao_a",
    section: "A",
    recordType: null,
    fields: [
      "prontuario",
      "data_nascimento",
      "idade",
      "periodo_internacao",
      "diagnostico_internacao",
      "unidade_funcional",
      "especialidade_cirurgia",
      "especialidade_internacao",
    ],
  },
  {
    key: "secao_b_anamnese",
    section: "B",
    recordType: "anamnesis",
    fields: ["hda", "hd_cid", "ap_app", "af", "exame_fisico", "cd", "criacao_anamnese"],
  },
  {
    key: "secao_b_evolucao",
    section: "B",
    recordType: "evolution",
    fields: ["hd_cid", "exame_fisico", "procedimentos_condutas_queixas", "frequencia_diaria"],
  },
  {
    key: "secao_c",
    section: "C",
    recordType: null,
    onlyWhen: "tem_cirurgia",
    fields: [
      "especialidade",
      "unidade_funcional",
      "inicio",
      "fim",
      "diagnostico_cid",
      "descricao_procedimento",
      "descricao_tecnica",
      "uso_opme",
    ],
  },
  {
    key: "secao_d_anamnese",
    section: "D",
    recordType: "anamnesis",
    fields: [
      "motivo_internacao",
      "ap_app",
      "af",
      "exame_fisico",
      "escala_braden",
      "escala_morse",
      "cd",
      "criacao_anamnese",
    ],
  },
  {
    key: "secao_d_evolucao",
    section: "D",
    recordType: "evolution",
    fields: ["motivo_internacao", "exame_fisico", "condutas", "escala_braden", "escala_morse", "criacao_evolucao", "curativo"],
  },
  { key: "secao_e", section: "E", recordType: null, onlyWhen: "tem_outras_categorias", fields: ["descricao"] },
];

const NOT_REGISTERED_PREFIXES = ["não registrado", "nao registrado"];
const NON_CONFORMING_PREFIXES = ["não conforme", "nao conforme", "incompleto"];
const NOT_APPLICABLE_PREFIXES = ["não se aplica", "nao se aplica"];
const NOT_APPLICABLE_EXACT = ["n/a", "na"];
const NEGATIVE_EXACT = ["não", "nao", "false"];

type FieldValue = string | number | boolean | null | undefined;

/** The key of the audit JSON that holds a section letter and record type, e.g. B + evolution -> secao_b_evolucao. */
export function sectionKeyOf(section: string, recordType: RecordType | null): string | null {
  const spec = SECTIONS.find((candidate) => candidate.section === section && candidate.recordType === recordType);
  return spec?.key ?? null;
}

/** Reads the status out of a field value, with the same rules the conformity score applies:
 * a plain recorded value (a date, a specialty) counts as conforme. */
export function statusOf(value: FieldValue): FieldStatus {
  if (typeof value === "boolean") return value ? "conforme" : "nao_conforme";
  if (value === null || value === undefined || value === "") return "nao_registrado";

  const text = String(value).toLowerCase().trim();
  if (text === "") return "nao_registrado";
  if (NOT_REGISTERED_PREFIXES.some((prefix) => text.startsWith(prefix))) return "nao_registrado";
  if (NON_CONFORMING_PREFIXES.some((prefix) => text.startsWith(prefix))) return "nao_conforme";
  if (NOT_APPLICABLE_PREFIXES.some((prefix) => text.startsWith(prefix)) || NOT_APPLICABLE_EXACT.includes(text)) {
    return "nao_se_aplica";
  }
  if (NEGATIVE_EXACT.includes(text)) return "nao_conforme";
  return "conforme";
}

interface AiMeta {
  campos_enviados?: string[];
  campos_null?: string[];
  campos_erro?: Array<{ campo?: string }>;
  campos_ok?: string[];
}

/** Where a field's value came from, from the `_ia_meta` the auditor attaches. A field with several
 * AI calls (one per day) is ai_failed if any call failed, ai_null if every answer was null. */
function sourceOf(path: string, meta: AiMeta | undefined): FieldSource {
  if (!meta?.campos_enviados?.includes(path)) return "rule";
  if (meta.campos_erro?.some((error) => error.campo === path)) return "ai_failed";
  const answered = meta.campos_ok?.includes(path) ?? false;
  if (meta.campos_null?.includes(path) && !answered) return "ai_null";
  return "ai";
}

/** Splits an audit result into one row per audited field, with status and source. */
export function extractAuditFields(result: RawAuditResult): AuditFieldRow[] {
  const data = (result.audit_data ?? result) as unknown as Record<string, unknown>;
  const meta = data["_ia_meta"] as AiMeta | undefined;
  const rows: AuditFieldRow[] = [];

  for (const spec of SECTIONS) {
    const values = data[spec.key] as Record<string, FieldValue> | undefined;
    if (!values) continue;
    if (spec.onlyWhen && !values[spec.onlyWhen]) continue;

    for (const field of spec.fields) {
      if (!(field in values)) continue;
      const value = values[field];
      rows.push({
        section: spec.section,
        record_type: spec.recordType,
        field,
        value: value === null || value === undefined ? null : String(value),
        status: statusOf(value),
        source: sourceOf(`${spec.key}.${field}`, meta),
      });
    }
  }

  return rows;
}
