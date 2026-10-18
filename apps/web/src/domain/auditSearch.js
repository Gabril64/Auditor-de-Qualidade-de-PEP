/** The dashboard search: finds audits by prontuário number or attendance, typed with or without the dots. */

const digitsOf = (text) => String(text ?? '').replace(/\D/g, '');
const plain = (text) => String(text ?? '').toLowerCase().trim();

/** Whether an audit row matches what was typed; an empty search matches everything. */
export function matchesSearch(audit, query) {
  const text = plain(query);
  if (text === '') return true;

  const fields = [audit?.record_number_display, audit?.record_number, audit?.encounter];
  if (fields.some((field) => plain(field).includes(text))) return true;

  const digits = digitsOf(text);
  return digits !== '' && fields.some((field) => digitsOf(field).includes(digits));
}
