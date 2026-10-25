// Folders. Grist has no folders: a file sits in an Attachments cell, and a cell belongs to a record (a row). So a folder here is a record:
// a new row with a name in the record's title column, ready to take files, and renaming a folder renames that cell.
// Pure: this builds the actions, nothing calls Grist.

export const MAX_NAME = 200;

/** A name as it will be stored: spaces tidied, not too long. */
export const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** A column a folder's name can be written to: plain text, not a formula. */
export const canName = (col) => !!col && col.kind === 'Text' && !col.isFormula;

/**
 * The action that makes a folder. `prefill` is the value a Select-by link needs so the new record shows under the current selection.
 * @returns [] when the name is empty or there is no column to put it in
 */
export function newFolder(table, name, { titleCol, prefill = null } = {}) {
  const clean = cleanName(name);
  if (!clean || !canName(titleCol)) return [];
  const fields = { [titleCol.id]: clean };
  if (prefill && prefill.col && prefill.col !== titleCol.id) fields[prefill.col] = prefill.value;
  return [['AddRecord', table, null, fields]];
}

/** The action that renames a folder; none when the name is empty, unchanged, or there is no column to write it to. */
export function renameFolder(table, rowId, name, { titleCol, current = '' } = {}) {
  const clean = cleanName(name);
  if (!clean || clean === cleanName(current) || !canName(titleCol)) return [];
  return [['UpdateRecord', table, rowId, { [titleCol.id]: clean }]];
}

/**
 * Which records the Files layout shows although they have no file: all of them, or only some (a Set of record ids: the folders made in this
 * visit). Only while nothing narrows the wall (a search, a type chip, a tag), because then "no file" means "no match".
 */
export function showsEmpty(rec, { empty = null, narrowed = false } = {}) {
  if (narrowed || rec.files.length) return false;
  return empty === true || (empty instanceof Set && empty.has(rec.rowId));
}

/** The id of the record that appeared when a folder was made: the largest one that was not there before. */
export function newestId(rows, before) {
  let best = null;
  for (const r of rows) if (!before.has(r.id) && (best == null || r.id > best)) best = r.id;
  return best;
}
