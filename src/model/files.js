// Rows + file metadata -> the records and files every layout draws.
//
// One file is one attachment id at one place: a record, a column, a position in the cell. The same
// attachment in two cells is two files here (Grist lets a cell copy carry the id), because removing or
// reordering is always about one place. Pure: tested in tests/files.test.mjs.

import { attachmentIds, cellText, isError } from './values.js';
import { extOf, kindOf, groupOf, KIND_GROUPS } from './kinds.js';
import { showsEmpty } from './folders.js';

/**
 * _grist_Attachments rows -> Map(id -> meta). Rows marked deleted are left out: their files are gone
 * from the store, and a cell that still names one counts as missing.
 */
export function metaFromRows(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || !Number.isInteger(r.id) || r.timeDeleted) continue;
    const name = String(r.fileName || `file-${r.id}`);
    const ext = extOf(r.fileExt || '') || extOf(name);
    out.set(r.id, {
      id: r.id, name, ext, kind: kindOf(ext), size: Number(r.fileSize) || 0, ident: String(r.fileIdent || ''),
      w: Number(r.imageWidth) || 0, h: Number(r.imageHeight) || 0,
      uploaded: typeof r.timeUploaded === 'number' ? r.timeUploaded : null,
    });
  }
  return out;
}

/**
 * Build the gallery.
 * @param {{rows, columns, roles: {files, title, fields}, meta: Map, labels?: object, fmt?: object}} p
 * @returns {{records, files, missing: number, errors: number}}
 *   records: [{rowId, title, fields: [{id, label, text}], files: [file], errors}]
 *   file: {key, attId, rowId, col, index, name, ext, kind, group, size, ident, w, h, uploaded, readOnly, recordTitle}
 */
export function buildGallery({ rows, columns, roles, meta, labels = {}, fmt = {} }) {
  const colById = new Map(columns.map((c) => [c.id, c]));
  const fileCols = (roles.files || []).map((id) => colById.get(id)).filter(Boolean);
  const titleCol = roles.title ? colById.get(roles.title) : null;
  const fieldCols = (roles.fields || []).map((id) => colById.get(id)).filter(Boolean);
  let missing = 0, errors = 0;
  const records = [];
  const files = [];
  for (const row of rows || []) {
    const title = titleCol ? cellText(row[titleCol.id], titleCol, labels[titleCol.id], fmt) : null;
    const rec = {
      rowId: row.id,
      title: title == null ? '' : String(title),
      fields: fieldCols.map((c) => ({ id: c.id, label: c.label, text: cellText(row[c.id], c, labels[c.id], fmt) })),
      files: [],
      errors: 0,
    };
    for (const c of fileCols) {
      const v = row[c.id];
      if (isError(v)) { rec.errors++; errors++; continue; }
      attachmentIds(v).forEach((attId, index) => {
        const m = meta.get(attId);
        if (!m) { missing++; return; }
        const f = {
          key: `${row.id}:${c.id}:${index}:${attId}`, attId, rowId: row.id, col: c.id, index,
          name: m.name, ext: m.ext, kind: m.kind, group: groupOf(m.kind), size: m.size, ident: m.ident, w: m.w, h: m.h, uploaded: m.uploaded,
          readOnly: !!c.isFormula, recordTitle: rec.title,
        };
        rec.files.push(f);
        files.push(f);
      });
    }
    records.push(rec);
  }
  return { records, files, missing, errors };
}

/** The file a card shows on its cover: the first that has a picture to show, else the first at all. */
export function coverOf(rec) {
  return rec.files.find((f) => f.kind === 'image') || rec.files.find((f) => f.kind === 'pdf' || f.kind === 'video' || f.kind === 'heic') || rec.files[0] || null;
}

/** Files a card can flip through on hover: everything that draws as a picture. */
export const flippable = (rec) => rec.files.filter((f) => f.kind === 'image' || f.kind === 'pdf' || f.kind === 'video' || f.kind === 'heic');

export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every word of the query must appear in the file's name, its record's title or the record's fields. */
export function matcher(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const m = (...texts) => {
    const hay = fold(texts.filter(Boolean).join(' '));
    return words.every((w) => hay.includes(w));
  };
  m.words = words;
  /** The same, but a word may also be found in a file's text (already folded): some words in the record, some in the file. */
  m.within = (folded, ...texts) => {
    const hay = fold(texts.filter(Boolean).join(' '));
    return words.every((w) => hay.includes(w) || folded.includes(w));
  };
  return m;
}

/** Counts per filter group, for the chips: {all, image, pdf, video, audio, other}. */
export function groupCounts(files) {
  const out = { all: files.length };
  for (const g of KIND_GROUPS) out[g] = 0;
  for (const f of files) out[f.group]++;
  return out;
}

export const SORTS = ['cell', 'name', 'newest', 'oldest', 'taken-asc', 'taken-desc', 'largest', 'type'];
const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
const byName = (a, b) => (collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name));

/**
 * Sort a list of files (a copy). 'cell' keeps the records' order and each cell's order.
 * 'taken-asc' and 'taken-desc' go by the date a photo says it was taken (opts.taken(file) -> milliseconds or null); photos with no date come last.
 */
export function sortFiles(files, sort, opts = {}) {
  const list = files.slice();
  switch (sort) {
    case 'name': return list.sort(byName);
    case 'newest': return list.sort((a, b) => (b.uploaded || 0) - (a.uploaded || 0) || byName(a, b));
    case 'oldest': return list.sort((a, b) => (a.uploaded || 0) - (b.uploaded || 0) || byName(a, b));
    case 'taken-asc':
    case 'taken-desc': {
      const dir = sort === 'taken-asc' ? 1 : -1;
      const when = (f) => (opts.taken ? opts.taken(f) : null);
      return list.sort((a, b) => {
        const x = when(a), y = when(b);
        if (x == null && y == null) return (a.uploaded || 0) - (b.uploaded || 0) || byName(a, b);
        if (x == null) return 1;
        if (y == null) return -1;
        return (x - y) * dir || byName(a, b);
      });
    }
    case 'largest': return list.sort((a, b) => b.size - a.size || byName(a, b));
    case 'type': return list.sort((a, b) => a.ext.localeCompare(b.ext) || byName(a, b));
    default: return list;
  }
}

/**
 * What the Files layout shows: the records with their matching files, filtered by search and the
 * chosen group, each record's files sorted. Records left with no file are dropped, except (when nothing narrows the wall) the folders
 * `empty` asks for: every record without a file (true) or the ids in a Set.
 * @returns {{groups: [{rec, files}], files: [file]}} files = the flat order the lightbox steps through
 */
export function visibleFiles(gallery, { query = '', group = 'all', sort = 'cell', inside = null, taken = null, tag = '', empty = null } = {}) {
  const match = matcher(query);
  const groups = [];
  const flat = [];
  for (const rec of gallery.records) {
    const recText = [rec.title, ...rec.fields.map((f) => f.text)];
    const keep = rec.files.filter((f) => {
      if (group !== 'all' && f.group !== group) return false;
      if (tag && !(f.tags || []).some((x) => x.toLowerCase() === tag.toLowerCase())) return false;
      if (!match) return true;
      const entry = inside?.(f);   // the file's own text, when the search looks inside files
      return entry ? match.within(entry.all, f.name, f.notesText, ...recText) : match(f.name, f.notesText, ...recText);
    });
    if (!keep.length && !showsEmpty(rec, { empty, narrowed: !!match || group !== 'all' || !!tag })) continue;
    const sorted = sortFiles(keep, sort, { taken });
    groups.push({ rec, files: sorted });
    flat.push(...sorted);
  }
  return { groups, files: flat };
}

/** What the Cards layout shows: records whose title, fields or file names match. Records with no files stay. */
export function visibleRecords(gallery, { query = '', inside = null } = {}) {
  const match = matcher(query);
  if (!match) return gallery.records;
  return gallery.records.filter((rec) => {
    const texts = [rec.title, ...rec.fields.map((f) => f.text), ...rec.files.map((f) => f.name), ...rec.files.map((f) => f.notesText)];
    return match(...texts) || (inside && rec.files.some((f) => { const e = inside(f); return e && match.within(e.all, ...texts); }));
  });
}
