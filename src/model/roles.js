// Which columns hold the files, which one names a record, and which ones a card shows.
//
// Attachments columns are found by type alone; nothing else in Grist has that type. The title is the
// column a person would call the record by, and the card fields are a short pick of what is left.
// Pure: the input is the column list from model/schema.js.

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

// Name patterns for the title, English / German / French, matched against the column id and label.
const TITLE_NAMES = [
  'name', 'title', 'subject', 'product', 'item', 'label', 'description', 'site', 'property', 'address', 'project', 'customer', 'client',
  'bezeichnung', 'titel', 'produkt', 'artikel', 'betreff', 'objekt', 'adresse', 'projekt', 'kunde',
  'nom', 'titre', 'intitule', 'produit', 'article', 'objet', 'adresse', 'projet', 'client',
];
// Columns that are rarely what a card should say first.
const NOT_TITLE = /^(id|uuid|key|code|ref|sku|notes?|comments?|bemerkung|remarque)$/;

/** Columns a card can show as a field: anything readable as text. */
const FIELD_KINDS = ['Text', 'Numeric', 'Int', 'Bool', 'Date', 'DateTime', 'Choice', 'ChoiceList', 'Ref', 'RefList'];

export const isFileColumn = (c) => c && c.kind === 'Attachments';
export const isFieldColumn = (c) => c && FIELD_KINDS.includes(c.kind);

function titleScore(c) {
  if (!isFieldColumn(c) || c.kind === 'Bool') return -1;
  const id = fold(c.id), label = fold(c.label);
  if (NOT_TITLE.test(id)) return 0;
  let s = c.kind === 'Text' ? 2 : c.kind === 'Ref' || c.kind === 'Choice' ? 1 : 0.5;
  const hit = TITLE_NAMES.findIndex((n) => id === n || label === n || id.startsWith(n + ' ') || label.startsWith(n + ' ') || id.endsWith(' ' + n) || label.endsWith(' ' + n));
  if (hit >= 0) s += 10 - hit * 0.1;
  return s;
}

/**
 * Detect the roles.
 * @param {Array} columns  from tableColumns()
 * @returns {{files: string[], title: string|null, fields: string[]}} column ids
 */
export function detectRoles(columns) {
  const files = columns.filter(isFileColumn).map((c) => c.id);
  let best = null, bestScore = 0;
  columns.forEach((c, i) => {
    // Earlier columns win ties: the first Text column is usually the record's name.
    const s = titleScore(c) - i * 0.01;
    if (s > bestScore) { best = c; bestScore = s; }
  });
  const title = best ? best.id : null;
  const fields = columns.filter((c) => isFieldColumn(c) && c.id !== title && !c.id.startsWith('gristHelper')).slice(0, 2).map((c) => c.id);
  return { files, title, fields };
}

/**
 * Roles as saved in the widget options -> column ids that exist now. Columns are saved by ref, so a
 * renamed column is still found; the id is a fallback for a copy of the document where refs differ.
 * Anything that no longer exists, or no longer has a fitting type, is dropped.
 */
export function fromStored(stored, columns) {
  if (!stored || typeof stored !== 'object') return null;
  const find = (s) => (s && (columns.find((c) => s.ref && c.ref === s.ref) || columns.find((c) => c.id === s.id))) || null;
  const list = (v) => (Array.isArray(v) ? v : []).map(find).filter(Boolean);
  const files = list(stored.files).filter(isFileColumn).map((c) => c.id);
  const title = find(stored.title);
  return {
    files,
    title: title && isFieldColumn(title) ? title.id : null,
    fields: list(stored.fields).filter(isFieldColumn).map((c) => c.id).slice(0, 4),
  };
}

/** Column ids -> the saved form, {ref, id} per column. */
export function toStored(roles, columns) {
  const one = (id) => { const c = columns.find((x) => x.id === id); return c ? { ref: c.ref, id: c.id } : null; };
  return {
    files: (roles.files || []).map(one).filter(Boolean),
    title: roles.title ? one(roles.title) : null,
    fields: (roles.fields || []).map(one).filter(Boolean),
  };
}

/** Saved roles fall back to detection for whatever they lack (no files column saved -> detected ones). */
export function resolveRoles(stored, columns) {
  const auto = detectRoles(columns);
  const saved = fromStored(stored, columns);
  if (!saved) return { ...auto, source: 'auto' };
  return {
    files: saved.files.length ? saved.files : auto.files,
    title: stored.title === null ? null : saved.title || auto.title,
    fields: Array.isArray(stored.fields) ? saved.fields : auto.fields,
    source: 'saved',
  };
}
