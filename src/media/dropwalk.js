// Reading a folder that was dropped on the page, or chosen with a directory picker, into a flat list of files with their paths.
// A drop's entries must be taken inside the drop event itself (the browser clears them afterwards), so droppedFiles() does that
// part at once and walkEntries() reads the folders later.

import { skipName } from '../model/importfolder.js';

/**
 * The files of a drop, as `[...dataTransfer.files]`, plus, when the drop holds a folder, its entries (a non-enumerable `folderEntries` on the
 * array) so addFiles can import the folder. A dropped folder shows up in `files` as one empty file, which is no use to upload.
 */
export function droppedFiles(dt) {
  const files = [...(dt?.files || [])];
  const entries = [];
  for (const it of dt?.items || []) {
    if (it.kind !== 'file') continue;
    const e = typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null;
    if (e) entries.push(e);
  }
  if (entries.some((e) => e.isDirectory)) Object.defineProperty(files, 'folderEntries', { value: entries });
  return files;
}

const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
// A reader hands back a hundred entries at a time, and an empty answer means the end.
const listOf = async (dir) => {
  const reader = dir.createReader();
  const all = [];
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
  }
};

/**
 * Every file under the entries, with its path from the dropped folder's name down ('Customer/2024/a.pdf'). A hidden folder inside (.git) is not
 * entered, only counted; the hidden files themselves are left to planImport, which counts them too. Files and folders that cannot be read are
 * counted, not fatal. Stops reading after `limit` files.
 * @returns {{ items: [{ path, file }], unreadable: number, skippedDirs: number, tooMany: boolean }}
 */
export async function walkEntries(entries, { limit = Infinity } = {}) {
  const items = [];
  let unreadable = 0, skippedDirs = 0, tooMany = false;
  const visit = async (entry, prefix) => {
    if (tooMany) return;
    if (prefix && entry.isDirectory && skipName(entry.name)) { skippedDirs++; return; }
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    try {
      if (entry.isFile) {
        if (items.length >= limit) { tooMany = true; return; }
        items.push({ path, file: await fileOf(entry) });
      } else if (entry.isDirectory) {
        for (const child of await listOf(entry)) await visit(child, path);
      }
    } catch { unreadable++; }
  };
  for (const e of entries) await visit(e, '');
  return { items, unreadable, skippedDirs, tooMany };
}

/** The files a directory picker gave (each File has a webkitRelativePath), as the same list. Files without a path stay loose. */
export function listFromInput(files) {
  return [...files].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

/** True when a picked list came from a folder: every browser that supports the picker fills the relative path. */
export const hasFolders = (files) => [...files].some((f) => /[\\/]/.test(f.webkitRelativePath || ''));
