import { statusOf } from "./domain/auditFields.js";
import {
  DOCUMENT_ROWS,
  IDENTIFICATION_ITEMS,
  MEDICAL_ANAMNESIS_ITEMS,
  MEDICAL_EVOLUTION_ITEMS,
  NURSING_ANAMNESIS_ITEMS,
  NURSING_EVOLUTION_ITEMS,
  SURGERY_ITEMS,
  TEAM_ITEMS,
  TEAM_RECORD_KINDS,
  type ItemSpec,
} from "./transformerSpecs.js";

type FieldValue = string | number | boolean;
type Fields = Record<string, FieldValue | null | undefined>;
type Status = "conforme" | "nao_conforme" | "nao_se_aplica";

interface ConformityCount {
  valid?: number;
  total?: number;
  percent?: number;
}

interface Counts {
  valid: number;
  total: number;
}

interface DocumentMatrix {
  datas?: string[];
  matriz?: Record<string, Record<string, unknown>>;
}

interface AuditData {
  secao_a?: Fields;
  secao_b_anamnese?: Fields;
  secao_b_evolucao?: Fields;
  secao_c?: Fields;
  secao_d_anamnese?: Fields;
  secao_d_evolucao?: Fields;
  secao_e?: Fields;
  conformity_a?: ConformityCount;
  conformity_b_anamnese?: ConformityCount;
  conformity_b_evolucao?: ConformityCount;
  conformity_c?: ConformityCount;
  conformity_d_anamnese?: ConformityCount;
  conformity_d_evolucao?: ConformityCount;
  conformity_e?: ConformityCount;
  conformity_global?: ConformityCount;
  matriz_documentos?: DocumentMatrix;
}

export interface RawAuditResult extends AuditData {
  record_id?: string;
  audit_data?: AuditData;
}

export interface AuditItem {
  item: string;
  valor: FieldValue;
  status: Status;
  /** Added by the audit detail, so the front end can edit the item; the transformer leaves it out. */
  ref?: { section: string; record_type: "anamnesis" | "evolution" | null; field: string } | null;
}

interface ItemGroup {
  titulo: string;
  itens: AuditItem[];
}

interface SectionHeader {
  id: string;
  titulo: string;
  conformes: number;
  total: number;
  conformidade: number;
}

interface FlatSection extends SectionHeader {
  itens: AuditItem[];
}

interface GroupedSection extends SectionHeader {
  subgrupos: ItemGroup[];
}

type Section = FlatSection | GroupedSection;

export interface NonConformity {
  secao: string;
  item: string;
  descricao: string;
}

export interface DocumentCountRow {
  tipo: string;
  total: number;
  conformidade: number;
  [day: string]: string | number | boolean;
}

export interface TransformedAudit {
  prontuario: FieldValue;
  conformidade_geral: number;
  secoes: Section[];
  nao_conformidades: NonConformity[];
  quantitativo: DocumentCountRow[];
  days?: string[];
}

const NOT_AVAILABLE = "N/A";
const UNKNOWN_RECORD = "Desconhecido";

/** Converts one `data_extract` result into the structure the front end renders. */
export function transformAuditResult(rawResult: RawAuditResult): TransformedAudit {
  const auditData = rawResult.audit_data || rawResult;
  const recordId = rawResult.record_id || auditData.secao_a?.prontuario || UNKNOWN_RECORD;
  const sections = buildSections(auditData);
  const globalCounts = readCounts(auditData.conformity_global);
  const days = extractDays(auditData.matriz_documentos?.datas ?? []);

  return {
    prontuario: recordId,
    conformidade_geral: percentage(globalCounts),
    secoes: sections,
    nao_conformidades: collectNonConformities(sections),
    quantitativo: buildDocumentCountRows(auditData, days),
    days: days.length > 0 ? days : undefined,
  };
}

function buildSections(auditData: AuditData): Section[] {
  const sections: Section[] = [buildIdentification(auditData), buildMedical(auditData)];
  if (auditData.secao_c?.tem_cirurgia) sections.push(buildSurgery(auditData));
  sections.push(buildNursing(auditData));
  if (auditData.secao_e?.["categorias"] || auditData.secao_e?.tem_outras_categorias) sections.push(buildTeam(auditData));
  return sections;
}

function buildIdentification(data: AuditData): FlatSection {
  const items = buildItems(data.secao_a, IDENTIFICATION_ITEMS);
  return buildFlatSection("A", "Identificação do Paciente", readCounts(data.conformity_a), items);
}

function buildMedical(data: AuditData): GroupedSection {
  const counts = sumCounts(data.conformity_b_anamnese, data.conformity_b_evolucao);
  return buildGroupedSection("B", "Anamnese / Evolução Médica", counts, [
    { titulo: "Anamnese Médica", itens: buildItems(data.secao_b_anamnese, MEDICAL_ANAMNESIS_ITEMS) },
    { titulo: "Evolução Médica", itens: buildItems(data.secao_b_evolucao, MEDICAL_EVOLUTION_ITEMS) },
  ]);
}

function buildSurgery(data: AuditData): FlatSection {
  const items = buildItems(data.secao_c, SURGERY_ITEMS);
  return buildFlatSection("C", "Bloco Cirúrgico", readCounts(data.conformity_c), items);
}

function buildNursing(data: AuditData): GroupedSection {
  const counts = sumCounts(data.conformity_d_anamnese, data.conformity_d_evolucao);
  return buildGroupedSection("D", "Anamnese / Evoluções de Enfermagem", counts, [
    { titulo: "Anamnese Enfermagem", itens: buildItems(data.secao_d_anamnese, NURSING_ANAMNESIS_ITEMS) },
    { titulo: "Evolução Enfermagem", itens: buildItems(data.secao_d_evolucao, NURSING_EVOLUTION_ITEMS) },
  ]);
}

function buildTeam(data: AuditData): Section {
  const title = "Equipe Multiprofissional";
  const categories = data.secao_e?.["categorias"];
  if (typeof categories !== "object" || categories === null) {
    return buildFlatSection("E", title, readCounts(data.conformity_e), buildItems(data.secao_e, TEAM_ITEMS));
  }

  const groups = Object.entries(categories as Record<string, Fields>).map(([category, kinds]) => ({
    titulo: displayName(category),
    itens: TEAM_RECORD_KINDS.map(({ label, jsonKey }) => {
      const value = kinds?.[jsonKey];
      return { item: label, valor: value || NOT_AVAILABLE, status: toStatus(value) };
    }),
  }));
  return buildGroupedSection("E", title, readCounts(data.conformity_e), groups);
}

/** The way a category is titled on screen: names the auditor already writes as titles are kept, and an
 * all-capitals one ("SERVIÇO SOCIAL") becomes "Serviço Social". */
export function displayName(category: string): string {
  if (category !== category.toUpperCase()) return category;
  return category.toLowerCase().replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase());
}

function buildFlatSection(id: string, title: string, counts: Counts, items: AuditItem[]): FlatSection {
  return { ...buildHeader(id, title, counts), itens: items };
}

function buildGroupedSection(id: string, title: string, counts: Counts, groups: ItemGroup[]): GroupedSection {
  return { ...buildHeader(id, title, counts), subgrupos: groups };
}

function buildHeader(id: string, title: string, counts: Counts): SectionHeader {
  return { id, titulo: title, conformes: counts.valid, total: counts.total, conformidade: percentage(counts) };
}

function buildItems(fields: Fields | undefined, specs: ItemSpec[]): AuditItem[] {
  return specs.map(([label, key]) => {
    const value = fields?.[key];
    return { item: label, valor: value || NOT_AVAILABLE, status: toStatus(value) };
  });
}

/** The front end shows three statuses: "não registrado" is shown as não conforme. */
function toStatus(value: FieldValue | null | undefined): Status {
  if (!value || value === NOT_AVAILABLE) return "nao_conforme";

  const status = statusOf(value);
  return status === "nao_registrado" ? "nao_conforme" : status;
}

function readCounts(count: ConformityCount | undefined): Counts {
  return { valid: count?.valid ?? 0, total: count?.total ?? 0 };
}

function sumCounts(...counts: Array<ConformityCount | undefined>): Counts {
  return counts.map(readCounts).reduce((sum, c) => ({ valid: sum.valid + c.valid, total: sum.total + c.total }));
}

function percentage({ valid, total }: Counts): number {
  return total > 0 ? Math.round((valid / total) * 1000) / 10 : 100;
}

function collectNonConformities(sections: Section[]): NonConformity[] {
  return sections.flatMap((section) => {
    const groups: Array<{ titulo: string | null; itens: AuditItem[] }> =
      "subgrupos" in section ? section.subgrupos : [{ titulo: null, itens: section.itens }];

    return groups.flatMap((group) =>
      group.itens
        .filter((item) => item.status === "nao_conforme")
        .map((item) => ({
          secao: section.id,
          item: group.titulo ? `${group.titulo} — ${item.item}` : item.item,
          descricao: `Valor: ${item.valor}`,
        })),
    );
  });
}

/** "3/12/2023" -> "03/12/2023": audits stored before the auditor padded the dates still line up. */
function paddedDate(date: string): string {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? `${match[1]!.padStart(2, "0")}/${match[2]!.padStart(2, "0")}/${match[3]}` : date;
}

function extractDays(dates: string[]): string[] {
  return dates.map((date) => {
    const match = paddedDate(date).match(/(\d{2})\/(\d{2})/);
    return match ? `${match[1]}/${match[2]}` : date;
  });
}

/** One row per document type: the days it exists on, how many, and how conforming its fields are. A day
 * is matched by the full date from the matrix, so the same day and month in another year does not count.
 * Medicine and nursing always have their rows; each other professional category (physiotherapy,
 * psychology...) adds one per record type, only when it has records. */
function buildDocumentCountRows(auditData: AuditData, days: string[]): DocumentCountRow[] {
  const matrix = auditData.matriz_documentos;
  const entriesByDocument = matrix?.matriz ?? {};
  const fullDates = (matrix?.datas ?? []).map(paddedDate);

  const buildRow = (label: string, matrixKey: string, conformity: number): DocumentCountRow => {
    const documentDates = new Set(Object.keys(entriesByDocument[matrixKey] ?? {}).map(paddedDate));
    const row: DocumentCountRow = { tipo: label, total: 0, conformidade: conformity };
    let presentCount = 0;

    days.forEach((day, index) => {
      const found = documentDates.has(fullDates[index] ?? day);
      row[day] = found;
      if (found) presentCount++;
    });

    row.total = presentCount;
    return row;
  };

  const rows = DOCUMENT_ROWS.map(([label, matrixKey, countsKey]) =>
    buildRow(label, matrixKey, percentage(readCounts(auditData[countsKey]))),
  );

  const categories = (auditData.secao_e?.["categorias"] ?? {}) as Record<string, Fields>;
  for (const [category, kinds] of Object.entries(categories)) {
    for (const { label, jsonKey } of TEAM_RECORD_KINDS) {
      const matrixKey = `${category} - ${label}`;
      if (!(matrixKey in entriesByDocument)) continue;
      rows.push(buildRow(`${label} ${displayName(category)}`, matrixKey, toStatus(kinds?.[jsonKey]) === "conforme" ? 100 : 0));
    }
  }

  return rows;
}
