// The Grist actions behind every gesture: one gesture is one action bundle, so Grist undoes it in one
// step. Pure: tested in tests/edits.test.mjs.

import { attachmentIds } from './values.js';
import { baseOf } from './kinds.js';

/** Ids -> an Attachments cell: ['L', ...ids], or null when nothing is left (Grist's own empty). */
export const cellOf = (ids) => (ids.length ? ['L', ...ids] : null);

/** Attach uploaded files to a record, after the ones already there. */
export function addFiles(table, rowId, col, current, newIds) {
  return [['UpdateRecord', table, rowId, { [col]: cellOf([...attachmentIds(current), ...newIds]) }]];
}

/**
 * Take one file out of its cell. The file is named by its place (index) and its id; the cell may have
 * changed since the widget drew it, so when the place no longer holds that id, the first place that
 * does is used, and when none does, there is nothing to do (null).
 */
export function removeFile(table, file, current) {
  const ids = attachmentIds(current);
  const at = ids[file.index] === file.attId ? file.index : ids.indexOf(file.attId);
  if (at < 0) return null;
  ids.splice(at, 1);
  return [['UpdateRecord', table, file.rowId, { [file.col]: cellOf(ids) }]];
}

/** Several files out of their cells at once (marked files): one UpdateRecord per touched cell, one bundle. */
export function removeFiles(table, files, currentOf) {
  const byCell = new Map();
  for (const f of files) {
    const k = f.rowId + '\u0000' + f.col;
    if (!byCell.has(k)) byCell.set(k, { rowId: f.rowId, col: f.col, files: [] });
    byCell.get(k).files.push(f);
  }
  const actions = [];
  for (const { rowId, col, files: list } of byCell.values()) {
    const ids = attachmentIds(currentOf(rowId, col));
    // Highest place first, so earlier removals don't shift the later ones.
    for (const f of [...list].sort((a, b) => b.index - a.index)) {
      const at = ids[f.index] === f.attId ? f.index : ids.indexOf(f.attId);
      if (at >= 0) ids.splice(at, 1);
    }
    actions.push(['UpdateRecord', table, rowId, { [col]: cellOf(ids) }]);
  }
  return actions;
}

/** Move a file to another place in its own cell (drag in the filmstrip; Make cover is place 0). */
export function moveFile(table, file, current, to) {
  const ids = attachmentIds(current);
  const at = ids[file.index] === file.attId ? file.index : ids.indexOf(file.attId);
  if (at < 0) return null;
  const target = Math.max(0, Math.min(ids.length - 1, to));
  if (target === at) return null;
  ids.splice(at, 1);
  ids.splice(target, 0, file.attId);
  return [['UpdateRecord', table, file.rowId, { [file.col]: cellOf(ids) }]];
}

/**
 * One new record per uploaded file: its title from the file name (when the title column is plain
 * text), the file in the files column, and the Select-by value when the widget is filtered by a link
 * (Grist does not fill that in for records a widget adds).
 * @param uploads [{id, name}]  ids from the upload, names as uploaded
 * @param o {titleCol: column|null, filesCol: string, prefill: {col, value}|null}
 */
export function newRecords(table, uploads, { titleCol = null, filesCol, prefill = null }) {
  if (!uploads.length) return [];
  const fields = { [filesCol]: uploads.map((u) => ['L', u.id]) };
  if (titleCol && titleCol.kind === 'Text' && !titleCol.isFormula) fields[titleCol.id] = uploads.map((u) => baseOf(u.name));
  if (prefill && prefill.col && prefill.col !== filesCol && !(titleCol && prefill.col === titleCol.id)) fields[prefill.col] = uploads.map(() => prefill.value);
  return [['BulkAddRecord', table, uploads.map(() => null), fields]];
}

/** Rename files in Grist (metadata, so owners only). Names are full names, extension included. */
export function renameFiles(list) {
  const clean = list.filter((x) => Number.isInteger(x.attId) && typeof x.name === 'string' && x.name.trim());
  if (!clean.length) return [];
  if (clean.length === 1) return [['UpdateRecord', '_grist_Attachments', clean[0].attId, { fileName: clean[0].name.trim() }]];
  return [['BulkUpdateRecord', '_grist_Attachments', clean.map((x) => x.attId), { fileName: clean.map((x) => x.name.trim()) }]];
}

/**
 * The value new records should carry for a Select-by link: the link column's value shared by every
 * row the widget shows (they are exactly the rows that match the selection). Null when the rows
 * disagree, or there are none to ask (then the new record may not show until it matches).
 */
export function sharedValue(rows, col) {
  if (!col || !rows.length) return null;
  const key = (v) => JSON.stringify(v ?? null);
  const first = key(rows[0][col]);
  if (!rows.every((r) => key(r[col]) === first)) return null;
  const v = rows[0][col];
  // keepEncoded hands a Reference back as ['R', table, id]; a write wants the bare id.
  if (Array.isArray(v) && v[0] === 'R') return v[2] || null;
  return v ?? null;
}

/**
 * Put a new file in another's place: the edited version of a picture saved "as the same file", or a
 * file replaced from the computer. Grist never changes a file's bytes (it names a file by their hash),
 * so the cell gets the new id where the old one was, and Undo brings the old one back.
 */
export function replaceFile(table, file, current, newId) {
  const ids = attachmentIds(current);
  const at = ids[file.index] === file.attId ? file.index : ids.indexOf(file.attId);
  if (at < 0) return null;
  ids[at] = newId;
  return [['UpdateRecord', table, file.rowId, { [file.col]: cellOf(ids) }]];
}

/**
 * The same, in every cell that holds the old file (it can sit in several, across tables): one action
 * per cell, in one bundle. places: [{tableId, colId, rowId, isFormula}]; currentOf(tableId, rowId, colId)
 * -> cell. Formula cells are left out: Grist refuses a write to them (and with it the whole bundle),
 * and they follow their formula anyway.
 */
export function replaceEverywhere(places, oldId, newId, currentOf) {
  return everyCell(places, oldId, currentOf, (ids) => ids.map((x) => (x === oldId ? newId : x)));
}

/** A file out of every cell that holds it, in one bundle; formula cells left out as above. */
export function removeEverywhere(places, attId, currentOf) {
  return everyCell(places, attId, currentOf, (ids) => ids.filter((x) => x !== attId));
}

function everyCell(places, attId, currentOf, change) {
  const seen = new Set();
  const actions = [];
  for (const p of places) {
    const key = `${p.tableId}|${p.rowId}|${p.colId}`;
    if (p.isFormula || seen.has(key)) continue;
    seen.add(key);
    const ids = attachmentIds(currentOf(p.tableId, p.rowId, p.colId));
    if (!ids.includes(attId)) continue;
    actions.push(['UpdateRecord', p.tableId, p.rowId, { [p.colId]: cellOf(change(ids)) }]);
  }
  return actions;
}

/** A copy (or an edited copy) right after the original in its cell. */
export function insertAfter(table, file, current, newId) {
  const ids = attachmentIds(current);
  const at = ids[file.index] === file.attId ? file.index : ids.indexOf(file.attId);
  ids.splice(at < 0 ? ids.length : at + 1, 0, newId);
  return [['UpdateRecord', table, file.rowId, { [file.col]: cellOf(ids) }]];
}

/**
 * Copy files to another record: the same files (one file, now in two places), after the ones the
 * target already has. Files already in the target cell are not added twice.
 */
export function copyFilesTo(table, files, targetRowId, targetCol, targetCurrent) {
  const ids = attachmentIds(targetCurrent);
  const add = files.map((f) => f.attId).filter((id, i, a) => a.indexOf(id) === i && !ids.includes(id));
  if (!add.length) return [];
  return [['UpdateRecord', table, targetRowId, { [targetCol]: cellOf([...ids, ...add]) }]];
}

/**
 * Move files to another record: out of their cells and into the target's, in one bundle (one Undo).
 * Files already in the target cell stay where they are.
 */
export function moveFilesTo(table, files, targetRowId, targetCol, currentOf) {
  const moving = files.filter((f) => !(f.rowId === targetRowId && f.col === targetCol));
  if (!moving.length) return [];
  const actions = removeFiles(table, moving, currentOf);
  const target = attachmentIds(currentOf(targetRowId, targetCol));
  const add = moving.map((f) => f.attId).filter((id, i, a) => a.indexOf(id) === i && !target.includes(id));
  if (add.length) actions.push(['UpdateRecord', table, targetRowId, { [targetCol]: cellOf([...target, ...add]) }]);
  return actions;
}
