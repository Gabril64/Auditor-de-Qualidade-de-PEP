import type { AuditItem, RawAuditResult, TransformedAudit } from "../transformer.js";
import {
  IDENTIFICATION_ITEMS,
  MEDICAL_ANAMNESIS_ITEMS,
  MEDICAL_EVOLUTION_ITEMS,
  NURSING_ANAMNESIS_ITEMS,
  NURSING_EVOLUTION_ITEMS,
  SURGERY_ITEMS,
  TEAM_ITEMS,
  type ItemSpec,
} from "../transformerSpecs.js";
import { extractAuditFields, type RecordType } from "./auditFields.js";

/** Where a displayed item lives in the audit, as `PATCH /api/audits/:id/revision` expects it. */
export interface ItemRef {
  section: string;
  record_type: RecordType | null;
  field: string;
}

type ItemGroupSpec = { recordType: RecordType | null; specs: ItemSpec[] };

/** The items of each section in the order the transformer builds them: one group per flat section,
 * two (anamnesis, evolution) for the grouped ones. */
const SECTION_GROUPS: Record<string, ItemGroupSpec[]> = {
  A: [{ recordType: null, specs: IDENTIFICATION_ITEMS }],
  B: [
    { recordType: "anamnesis", specs: MEDICAL_ANAMNESIS_ITEMS },
    { recordType: "evolution", specs: MEDICAL_EVOLUTION_ITEMS },
  ],
  C: [{ recordType: null, specs: SURGERY_ITEMS }],
  D: [
    { recordType: "anamnesis", specs: NURSING_ANAMNESIS_ITEMS },
    { recordType: "evolution", specs: NURSING_EVOLUTION_ITEMS },
  ],
  E: [{ recordType: null, specs: TEAM_ITEMS }],
};

const keyOf = (section: string, recordType: RecordType | null, field: string) =>
  `${section}:${recordType ?? ""}:${field}`;

/** Marks each item of a transformed audit with its `ref`, or null when the field is not one of the
 * audited fields (so it cannot be edited). `source` is the audit JSON the items were built from. */
export function annotateItemRefs(audit: TransformedAudit, source: RawAuditResult): TransformedAudit {
  const editable = new Set(extractAuditFields(source).map((row) => keyOf(row.section, row.record_type, row.field)));

  for (const section of audit.secoes) {
    const groups = SECTION_GROUPS[section.id] ?? [];
    const itemLists: AuditItem[][] = "subgrupos" in section ? section.subgrupos.map((g) => g.itens) : [section.itens];

    itemLists.forEach((items, groupIndex) => {
      const group = groups[groupIndex];
      items.forEach((item, itemIndex) => {
        const field = group?.specs[itemIndex]?.[1];
        const known = group !== undefined && field !== undefined && editable.has(keyOf(section.id, group.recordType, field));
        item.ref = known ? { section: section.id, record_type: group.recordType, field } : null;
      });
    });
  }

  return audit;
}
