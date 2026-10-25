// Grist's encoded cells (connect.js asks for keepEncoded) -> what a card or a caption shows.
//
// The shapes, as measured in Plan Studio's M0 and again here:
//   Attachments ['L', id, ...]          null when empty; ['L'] for an empty formula result
//   Date        ['d', secs]              secs = UTC midnight of that day
//   DateTime    ['D', secs, 'Zone/Name']
//   Reference   ['R', 'Table', id]       id 0 = empty
//   lists       ['L', ...items]          RefList ids, ChoiceList strings
//   errors etc. ['E', 'TypeError', ...], ['P'], ['C'] ... nothing usable
// Pure: tested in tests/values.test.mjs.

const isCode = (v, code) => Array.isArray(v) && v[0] === code;

/** An encoded cell -> a plain JS value (string, number, boolean) or null for anything else. */
export function plain(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return v;
  if (isCode(v, 'd') || isCode(v, 'D')) return typeof v[1] === 'number' ? v[1] : null;
  if (isCode(v, 'R')) return typeof v[2] === 'number' ? v[2] : null;
  return null;
}

/** True for a cell that holds an error (a formula that failed). */
export const isError = (v) => isCode(v, 'E');

/** The ids in an Attachments cell, in the cell's order; [] for empty, errors and anything unexpected. */
export function attachmentIds(v) {
  if (v == null) return [];
  if (typeof v === 'number') return v > 0 ? [v] : [];
  if (!Array.isArray(v)) return [];
  const list = v[0] === 'L' ? v.slice(1) : typeof v[0] === 'number' ? v : [];
  return list.filter((x) => Number.isInteger(x) && x > 0);
}

/** A Reference cell -> the row id (0 when empty). */
export function refId(v) {
  if (isCode(v, 'R')) return typeof v[2] === 'number' ? v[2] : 0;
  return typeof v === 'number' ? v : 0;
}

/** A list cell (RefList, ChoiceList) -> its items. */
export function listOf(v) {
  if (isCode(v, 'L')) return v.slice(1);
  return Array.isArray(v) && !(typeof v[0] === 'string' && v[0].length === 1) ? v : [];
}

/**
 * One cell as the text a card shows, or null when there is nothing to show.
 * @param fmt  {date(secs), dateTime(secs, zone), number(n)} formatters in the person's locale
 */
export function cellText(v, col, labels = null, fmt = {}) {
  if (v == null || v === '') return null;
  if (isError(v)) return '#' + (v[1] || 'Error');
  const label = (id) => labels?.get(id) ?? `${col.refTable || 'Row'}[${id}]`;
  switch (col.kind) {
    case 'Date': { const s = plain(v); return typeof s === 'number' ? (fmt.date ? fmt.date(s) : new Date(s * 1000).toISOString().slice(0, 10)) : null; }
    case 'DateTime': { const s = plain(v); return typeof s === 'number' ? (fmt.dateTime ? fmt.dateTime(s, Array.isArray(v) ? v[2] : null) : new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ')) : null; }
    case 'Ref': { const id = refId(v); return id ? label(id) : null; }
    case 'RefList': return listOf(v).map(label).join(', ') || null;
    case 'ChoiceList': return listOf(v).join(', ') || null;
    case 'Bool': return plain(v) === true ? '✓' : null;
    case 'Numeric': case 'Int': { const n = plain(v); return typeof n === 'number' ? (fmt.number ? fmt.number(n) : String(n)) : null; }
    case 'Attachments': return null;
    default: { const p = plain(v); return p == null || p === '' ? null : String(p); }
  }
}
