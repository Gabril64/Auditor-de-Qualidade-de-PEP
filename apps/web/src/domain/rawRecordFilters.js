/**
 * The tags above the original record on the detail screen: a day, a record type (anamnese or evolução)
 * and a professional category narrow down which entries are shown. Only what exists in the record
 * gets a tag, so medicine and nursing alone give two category tags and a social service entry adds one.
 */

const DATE_KEY = 'criacao_registro';
const CATEGORY_KEY = 'Categoria Profissional';
const TYPE_KEY = 'Tipo do registro';

const normalize = (text) =>
  String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const titleCase = (text) => text.toLowerCase().replace(/(^|[\s/])(\S)/g, (_, edge, letter) => edge + letter.toUpperCase());

/** "3/12/2023, 10:53" -> {key: '2023-12-03', label: '03/12'}; null when there is no readable date. */
export function dayOf(value) {
  const match = String(value ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  const dd = day.padStart(2, '0');
  const mm = month.padStart(2, '0');
  return { key: `${year}-${mm}-${dd}`, label: `${dd}/${mm}` };
}

/** 'anamnese' | 'evolucao' | null, from the entry type ("Anamnese", "Evolução"...). */
export function kindOf(value) {
  const text = normalize(value);
  if (text.includes('anamnese')) return 'anamnese';
  if (text.includes('evolu')) return 'evolucao';
  return null;
}

export const KIND_LABELS = { anamnese: 'Anamnese', evolucao: 'Evolução' };

/** What an entry is, for filtering: its day, type and category. */
export function facetsOf(entry) {
  const original = entry?.original ?? {};
  const category = String(original[CATEGORY_KEY] ?? '').trim();
  return {
    day: dayOf(original[DATE_KEY]),
    kind: kindOf(original[TYPE_KEY]),
    categoryKey: normalize(category),
    categoryLabel: category ? titleCase(category) : '',
  };
}

/**
 * The tags to show: days oldest first, the types present (anamnese before evolução), and the
 * categories present with medicine and nursing first.
 */
export function filterTags(entries) {
  const days = new Map();
  const kinds = new Set();
  const categories = new Map();

  for (const entry of entries ?? []) {
    const facets = facetsOf(entry);
    if (facets.day) days.set(facets.day.key, facets.day.label);
    if (facets.kind) kinds.add(facets.kind);
    if (facets.categoryKey) categories.set(facets.categoryKey, facets.categoryLabel);
  }

  const order = (key) => (key === 'medicina' ? 0 : key === 'enfermagem' ? 1 : 2);

  return {
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([key, label]) => ({ key, label })),
    kinds: ['anamnese', 'evolucao'].filter((kind) => kinds.has(kind)).map((key) => ({ key, label: KIND_LABELS[key] })),
    categories: [...categories]
      .sort(([a], [b]) => order(a) - order(b))
      .map(([key, label]) => ({ key, label })),
  };
}

/** Whether an entry passes the chosen tags; a tag left unset (null) lets everything through. */
export function matchesFilters(entry, { day = null, kind = null, category = null } = {}) {
  const facets = facetsOf(entry);
  if (day && facets.day?.key !== day) return false;
  if (kind && facets.kind !== kind) return false;
  if (category && facets.categoryKey !== category) return false;
  return true;
}
