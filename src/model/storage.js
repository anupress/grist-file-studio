// Where a document's attachment space goes, and what could be made smaller.
//
// What Grist does, as measured in M9 (tools/m1/storage-probe.js):
//   * every upload is a row of _grist_Attachments; the same bytes uploaded twice are two rows with the same
//     fileIdent (a hash) and are stored ONCE. So space is counted per fileIdent, not per row.
//   * a file nobody uses any more stays in the document (so Undo can bring it back) until Grist marks it
//     (timeDeleted, after "updateUsed") and an owner asks it to remove what is marked ("removeUnused").
// All of it is plain data in, plain data out, so it can be tested without a browser.

import { extOf, kindOf, KIND_GROUPS, groupOf } from './kinds.js';

/** Pictures the browser can read and write again (HEIC cannot be read by Chrome, an animated GIF would lose its frames). */
export const SHRINKABLE = new Set(['jpg', 'jpeg', 'jfif', 'pjpeg', 'png', 'webp', 'bmp']);
export const SIDE_CHOICES = [1024, 1600, 2048, 2560];
export const MIN_SHRINK_BYTES = 150e3;   // a photo smaller than this is not worth the trouble
export const BIG_BYTES = 1.5e6;          // a photo this big is worth re-encoding even when its pixels are few

/**
 * One entry per attachment row, with how many cells use it.
 * rows: raw _grist_Attachments rows; usesOf(id) -> the cells (any array) that hold the file.
 */
export function entriesOf(rows, usesOf) {
  const out = [];
  for (const r of rows || []) {
    if (!r || !Number.isInteger(r.id)) continue;
    const name = String(r.fileName || `file-${r.id}`);
    const ext = extOf(r.fileExt || '') || extOf(name);
    const uses = (usesOf(r.id) || []).length;
    out.push({
      id: r.id, name, ext, kind: kindOf(ext), size: Number(r.fileSize) || 0, ident: String(r.fileIdent || ''),
      w: Number(r.imageWidth) || 0, h: Number(r.imageHeight) || 0, uploaded: typeof r.timeUploaded === 'number' ? r.timeUploaded : null,
      flagged: !!r.timeDeleted, uses, used: uses > 0,
    });
  }
  return out;
}

/**
 * The picture of the whole document.
 * @returns {{total, inUse, unused, byKind, biggest}}
 *   total   {rows, files, bytes}   everything stored, counting each distinct content once
 *   inUse   {files, bytes}         contents some cell holds
 *   unused  {rows, files, bytes, list}   rows no cell holds; `bytes` is what removing them really frees (a row that shares
 *                                  its content with a used row frees nothing); `list` biggest first
 *   byKind  [{kind, files, bytes}] what is in use, by the filter groups, biggest first
 *   biggest [{key, id, name, ext, kind, size, w, h, ids, uses}]  contents in use, one per content, biggest first
 */
export function summarize(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = e.ident || `row:${e.id}`;
    let g = groups.get(key);
    if (!g) { g = { key, size: 0, rows: [], used: false }; groups.set(key, g); }
    g.rows.push(e);
    g.size = Math.max(g.size, e.size);
    if (e.used) g.used = true;
  }
  let totalBytes = 0, inUseBytes = 0, inUseFiles = 0, freeBytes = 0, freeFiles = 0;
  const kinds = new Map();
  const biggest = [];
  for (const g of groups.values()) {
    totalBytes += g.size;
    if (g.used) {
      inUseBytes += g.size; inUseFiles++;
      const rep = g.rows.reduce((a, b) => (b.used && (!a.used || b.uses > a.uses) ? b : a), g.rows[0]);
      const k = groupOf(rep.kind);
      const kk = kinds.get(k) || { kind: k, files: 0, bytes: 0 };
      kk.files++; kk.bytes += g.size; kinds.set(k, kk);
      biggest.push({ key: g.key, id: rep.id, name: rep.name, ext: rep.ext, kind: rep.kind, size: g.size, w: rep.w, h: rep.h,
        ids: g.rows.filter((r) => r.used).map((r) => r.id), uses: g.rows.reduce((n, r) => n + r.uses, 0) });
    } else { freeBytes += g.size; freeFiles++; }
  }
  const unusedRows = entries.filter((e) => !e.used).sort((a, b) => b.size - a.size);
  return {
    total: { rows: entries.length, files: groups.size, bytes: totalBytes },
    inUse: { files: inUseFiles, bytes: inUseBytes },
    unused: { rows: unusedRows.length, files: freeFiles, bytes: freeBytes, list: unusedRows },
    byKind: [...kinds.values()].sort((a, b) => b.bytes - a.bytes),
    biggest: biggest.sort((a, b) => b.size - a.size),
  };
}

/** About how large a photo is after it is redrawn with its long side at most `maxSide`. A guess; the real number comes from doing it. */
export function estimateAfter(e, maxSide) {
  if (!e.w || !e.h) return Math.round(e.size * 0.5);
  const s = Math.min(1, maxSide / Math.max(e.w, e.h));
  const pixels = e.w * e.h * s * s;
  if (e.ext === 'png') return Math.round(Math.min(e.size, e.size * s * s * 0.9));
  return Math.round(Math.min(e.size * 0.95, pixels * 0.2));   // a JPEG at 85 % is about 0.2 bytes per pixel
}

/**
 * The photos worth shrinking: readable by the browser, not tiny, and either larger than `maxSide` or very heavy.
 * Each gets `after` (a guess) and `saves`. Biggest saving first.
 */
export function shrinkCandidates(biggest, { maxSide = 2560, minBytes = MIN_SHRINK_BYTES, bigBytes = BIG_BYTES } = {}) {
  const out = [];
  for (const e of biggest) {
    if (!SHRINKABLE.has(e.ext) || e.size < minBytes) continue;
    const long = Math.max(e.w, e.h);
    if (!(long > maxSide) && e.size < bigBytes) continue;
    const after = estimateAfter(e, maxSide);
    if (after >= e.size * 0.9) continue;   // not worth a new file
    out.push({ ...e, after, saves: e.size - after });
  }
  return out.sort((a, b) => b.saves - a.saves);
}

/** How full the allowance is: {pct, state: 'ok' | 'near' | 'over'} (near from 80 %), or null without a limit. */
export function fill(bytes, limit) {
  if (!(limit > 0)) return null;
  const pct = (bytes / limit) * 100;
  return { pct, state: pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok' };
}

/** The allowance to start from: Grist's hosted service keeps 1 GB of attachments per document; elsewhere none is known. */
export function defaultLimit({ host = '', store = 'internal' } = {}) {
  return /(^|\.)getgrist\.com$/i.test(host) && store === 'internal' ? 1e9 : null;
}

export { KIND_GROUPS };
