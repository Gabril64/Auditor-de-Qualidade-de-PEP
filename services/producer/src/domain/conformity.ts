import type { AuditFieldRow, FieldStatus } from "./auditFields.js";

export interface Counts {
  valid: number;
  total: number;
  percent: number;
}

type CountableRow = Pick<AuditFieldRow, "section" | "record_type" | "field" | "status">;

/** Items the score leaves out of the total when they do not apply; any other "não se aplica"
 * still counts, as it does in the Python calculation. */
const OPTIONAL_ITEMS = new Set(["A:especialidade_cirurgia", "A:especialidade_internacao", "C:uso_opme", "D:curativo"]);

export function countsOf(rows: CountableRow[]): Counts {
  let valid = 0;
  let total = 0;

  for (const row of rows) {
    const notApplicable = row.status === "nao_se_aplica";
    if (notApplicable && OPTIONAL_ITEMS.has(`${row.section}:${row.field}`)) continue;
    total++;
    if (row.status === "conforme" || notApplicable) valid++;
  }

  return { valid, total, percent: total > 0 ? (valid / total) * 100 : 0 };
}

type Json = Record<string, unknown>;

const SECTION_COUNTERS: Array<[key: string, section: string, recordType: string | null]> = [
  ["conformity_a", "A", null],
  ["conformity_b_anamnese", "B", "anamnesis"],
  ["conformity_b_evolucao", "B", "evolution"],
  ["conformity_c", "C", null],
  ["conformity_d_anamnese", "D", "anamnesis"],
  ["conformity_d_evolucao", "D", "evolution"],
  ["conformity_e", "E", null],
];

/** Rewrites the `conformity_*` counters of an audit JSON from its field rows, keeping the other
 * properties of each counter (`applies`, `categoria`). Returns the global counts. */
export function applyConformity(audit: Json, rows: CountableRow[]): Counts {
  for (const [key, section, recordType] of SECTION_COUNTERS) {
    const sectionRows = rows.filter((row) => row.section === section && row.record_type === recordType);
    if (sectionRows.length === 0) continue;
    audit[key] = { ...(audit[key] as Json | undefined), ...countsOf(sectionRows) };
  }

  const global = countsOf(rows);
  audit["conformity_global"] = { ...global, invalid: global.total - global.valid };
  return global;
}

/** The field text for a status chosen by the auditor, keeping the "conforme (…)" format. */
export function textFor(status: Extract<FieldStatus, "conforme" | "nao_conforme">, comment?: string): string {
  const label = status === "conforme" ? "conforme" : "não conforme";
  const note = comment?.trim();
  return note ? `${label} (${note})` : label;
}
