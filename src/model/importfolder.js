// Importing a folder from the computer. A folder here is a record, so a folder tree becomes a set of records: one per folder, named after it,
// inside its parent folder when the table has a Parent column, with the folder's files in the record's Attachments cell.
// Pure: this plans and builds the actions; reading the dropped folder (media/dropwalk.js) and uploading (main.js) happen elsewhere.

import { cleanName } from './folders.js';

/** More than this in one import is refused: the upload tray lists every file and a failed hour-long upload helps nobody. */
export const MAX_IMPORT_FILES = 3000;

// Left out: dot files and folders (.DS_Store, .git), Office lock files (~$report.docx), Windows' own Thumbs.db and desktop.ini.
const LEFT_OUT = /^(\.|~\$|thumbs\.db$|desktop\.ini$|ehthumbs)/i;
export const skipName = (name) => LEFT_OUT.test(String(name ?? ''));

/** 'Customer/2024/a.pdf' → ['Customer', '2024', 'a.pdf'] (a browser may give back slashes). */
export const splitPath = (path) => String(path ?? '').split(/[\\/]+/).filter(Boolean);

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Plan the records for a set of files with their paths.
 * @param items  [{ path: 'Top/Sub/name.ext', file, size }]: a path with one part is a loose file, not in a folder
 * @param o.nest  folders go inside folders (a Parent column exists); else every folder that holds files becomes one record named by its path
 * @returns {{
 *   folders: [{ index, name, path, parent: number|null, files: [{ name, item }] }],   parents come before their children
 *   loose: [item], count: { folders, files, bytes, skipped, deepest }
 * }}
 */
export function planImport(items, { nest = true } = {}) {
  const nodes = new Map();   // 'Top/Sub' -> { name, path, parent, kids, files }
  const roots = [];
  const loose = [];
  let files = 0, bytes = 0, skipped = 0, deepest = 0;

  const nodeAt = (dirs) => {
    const key = dirs.join('/');
    let n = nodes.get(key);
    if (n) return n;
    const parent = dirs.length > 1 ? nodeAt(dirs.slice(0, -1)) : null;
    n = { name: dirs[dirs.length - 1], path: key, dirs, parent, kids: [], files: [] };
    nodes.set(key, n);
    (parent ? parent.kids : roots).push(n);
    return n;
  };

  for (const item of items) {
    const parts = splitPath(item.path);
    if (!parts.length) continue;
    if (parts.some(skipName)) { skipped++; continue; }
    files++; bytes += Number(item.size ?? item.file?.size) || 0;
    if (parts.length === 1) { loose.push(item); continue; }
    const dirs = parts.slice(0, -1);
    deepest = Math.max(deepest, dirs.length);
    nodeAt(dirs).files.push({ name: parts[parts.length - 1], item });
  }

  // Depth first, each folder's folders in name order, so the records come in the order a file manager shows them (whatever order the browser listed them in).
  const folders = [];
  const visit = (n) => {
    n.kids.sort(byName);
    n.files.sort(byName);
    if (nest || n.files.length) {
      n.index = folders.length;
      const up = nest ? n.parent : null;
      folders.push({ index: n.index, name: cleanName(nest ? n.name : n.dirs.join(' / ')) || 'Folder', path: n.path, parent: up ? up.index : null, files: n.files });
    }
    for (const k of n.kids) visit(k);
  };
  roots.sort(byName);
  for (const n of roots) visit(n);
  return { folders, loose, count: { folders: folders.length, files, bytes, skipped, deepest } };
}

/** The ids the new records will have: the next free ones, so a folder can point at its parent before either exists. */
export function nextIds(rows, n) {
  let top = 0;
  for (const r of rows) if (Number.isInteger(r.id) && r.id > top) top = r.id;
  return Array.from({ length: n }, (_, i) => top + 1 + i);
}

/**
 * One action that makes every folder of a plan, with its files already uploaded.
 * @param plan      from planImport
 * @param attId     (item) => the attachment id the upload gave it, or undefined when it failed
 * @param o.ids     the new rows' ids (nextIds), one per folder
 * @param o.parentId  the folder the imported ones go inside (top level when null); only when o.parentCol is set
 * @param o.prefill   {col, value}: what a Select-by link needs on every new record
 * @returns [] when there is nothing to write
 */
export function importActions(table, plan, attId, { ids, titleCol, filesCol, parentCol = null, parentId = null, prefill = null }) {
  const folders = plan.folders;
  if (!folders.length || !titleCol || !filesCol || ids.length !== folders.length) return [];
  const fields = { [titleCol.id]: folders.map((f) => f.name) };
  fields[filesCol] = folders.map((f) => {
    const got = f.files.map((x) => attId(x.item)).filter((id) => id != null);
    return got.length ? ['L', ...got] : null;
  });
  if (parentCol && parentCol !== titleCol.id && parentCol !== filesCol) fields[parentCol] = folders.map((f) => (f.parent != null ? ids[f.parent] : parentId || 0));
  if (prefill && prefill.col && ![titleCol.id, filesCol, parentCol].includes(prefill.col)) fields[prefill.col] = folders.map(() => prefill.value);
  return [['BulkAddRecord', table, ids, fields]];
}

/** The folders at the top of a plan (the ones that go straight into the target). */
export const topFolders = (plan) => plan.folders.filter((f) => f.parent == null);
