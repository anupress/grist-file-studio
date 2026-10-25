// File names built from a pattern, for zips and for renaming in Grist.
//
// A pattern is text with {placeholders}: any column by its id or label ({Invoice}, {Client name}),
// plus {file} (the name without its extension), {n} (the file's place in its record, 1, 2, 3),
// {nn} and {nnn} (the same, zero-padded), {N} (its place in the whole export), {date} (the upload
// day, YYYY-MM-DD), {record} (the record's title) and {id} (the row id). The extension is always the
// file's own and is never part of the pattern. Pure: tested in tests/names.test.mjs.

import { baseOf } from './kinds.js';

// Characters Windows, macOS or Linux refuse in a name, and control characters.
const BAD = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A name every file system accepts: no forbidden characters, no trailing dots or spaces, not too long. */
export function safeName(name, max = 120) {
  let s = String(name ?? '').replace(BAD, '-').replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  if (RESERVED.test(s)) s = '_' + s;
  if (s.length > max) s = s.slice(0, max).replace(/[. ]+$/, '');
  return s;
}

/** The placeholders a pattern uses, as written: '{Name} {n}' -> ['Name', 'n']. */
export function placeholders(pattern) {
  return [...String(pattern || '').matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
}

const pad = (n, w) => String(n).padStart(w, '0');

/**
 * Fill a pattern for one file.
 * @param ctx {file, n, N, columns: [{id, label}], text(colId) -> string|null, record: {rowId, title}}
 * @returns the name without extension (not yet made safe)
 */
export function fillPattern(pattern, ctx) {
  const { file, n = 1, N = 1, columns = [], text = () => null, record = {} } = ctx;
  return String(pattern || '{file}').replace(/\{([^{}]+)\}/g, (m, key) => {
    const k = key.trim();
    switch (k) {
      case 'file': return baseOf(file.name);
      case 'n': return String(n);
      case 'nn': return pad(n, 2);
      case 'nnn': return pad(n, 3);
      case 'N': return String(N);
      case 'id': return String(record.rowId ?? file.rowId ?? '');
      case 'record': return record.title || '';
      case 'date': return file.uploaded ? new Date(file.uploaded).toISOString().slice(0, 10) : '';
      default: {
        const col = columns.find((c) => c.id === k) || columns.find((c) => String(c.label).toLowerCase() === k.toLowerCase());
        if (!col) return m;   // left as written: the Columns panel flags it
        const v = text(col.id);
        return v == null ? '' : String(v);
      }
    }
  });
}

/** Placeholders in a pattern that name no column and no built-in, for a warning next to the field. */
export function unknownPlaceholders(pattern, columns) {
  const builtin = new Set(['file', 'n', 'nn', 'nnn', 'N', 'id', 'record', 'date']);
  return placeholders(pattern).map((k) => k.trim()).filter((k) => !builtin.has(k)
    && !columns.some((c) => c.id === k || String(c.label).toLowerCase() === k.toLowerCase()));
}

/**
 * Hands out names that are unique within a folder, case-insensitively (Windows and macOS treat
 * "Photo.JPG" and "photo.jpg" as one file): the second "Plan.pdf" becomes "Plan (2).pdf".
 */
export function uniqueNamer() {
  const used = new Set();
  return (folder, base, ext) => {
    const b = base || 'file';
    const e = ext ? '.' + ext : '';
    let name = b + e;
    for (let i = 2; used.has((folder + '/' + name).toLowerCase()); i++) name = `${b} (${i})${e}`;
    used.add((folder + '/' + name).toLowerCase());
    return name;
  };
}

/**
 * Every file of an export with its path inside the zip.
 * @param items [{file, record: {rowId, title}, n}]  in export order; n = the file's place in its record
 * @param o {pattern, folders: bool, folderPattern, columns, textOf(rowId, colId)}
 * @returns [{file, path}]
 */
export function exportPaths(items, { pattern = '{file}', folders = false, folderPattern = '{record}', columns = [], textOf = () => null }) {
  const unique = uniqueNamer();
  const folderNames = new Map();
  const usedFolders = uniqueNamer();
  return items.map(({ file, record, n }, idx) => {
    const ctxFor = (p) => fillPattern(p, { file, n, N: idx + 1, columns, record, text: (colId) => textOf(record.rowId, colId) });
    let folder = '';
    if (folders) {
      if (!folderNames.has(record.rowId)) {
        const raw = safeName(ctxFor(folderPattern)) || `Record ${record.rowId}`;
        folderNames.set(record.rowId, usedFolders('', raw, ''));
      }
      folder = folderNames.get(record.rowId);
    }
    const base = safeName(ctxFor(pattern), 150 - folder.length) || safeName(baseOf(file.name)) || `file-${file.attId}`;
    const name = unique(folder, base, file.ext);
    return { file, path: folder ? folder + '/' + name : name };
  });
}
