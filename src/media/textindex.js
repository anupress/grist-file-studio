// The text of the files, read once and kept in this browser so that a search can look inside them.
//
// What is read: PDFs (page by page with pdf.js), text files, HTML, and Word, Excel, PowerPoint and OpenDocument files
// (zip files with XML inside, see unzip.js). Pictures, video and audio have no text to read. Each file is read when asked
// and kept under its content hash (fileIdent), like the thumbnails, so the same file in two records is read once and a
// changed file is a new one. The text is kept in IndexedDB in THIS browser and nowhere else: never in the document.

import { readZip } from './unzip.js';
import { docxText, pptxText, odfText, xlsxText, htmlText } from './officetext.js';
import { prepare } from '../model/textsearch.js';
import { kindOf } from '../model/kinds.js';

const DB_NAME = 'file-studio-text';
const STORE = 'docs';
const RETRY_FAILED_AFTER = 7 * 24 * 3600 * 1000;   // a file that could not be read is tried again after a week
const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
const LIMITS = { pdf: 80e6, office: 30e6, text: 5e6 };   // bytes worth fetching for the text of one file
const MAX_PDF_PAGES = 500;
const MAX_CHARS = 2.5e6;                                  // of text kept for one file

/** 'pdf' | 'office' | 'text' for a file whose text can be read, else null. */
export function readableKind(ext, kind = kindOf(ext)) {
  if (ext === 'pdf') return 'pdf';
  if (OFFICE.has(ext)) return 'office';
  return kind === 'text' ? 'text' : null;
}
export const canRead = (f) => { const k = readableKind(f.ext, f.kind); return !!k && f.size <= LIMITS[k]; };

/** The text of a file, as an array of pages. Throws when the file cannot be read. */
export async function extractPages(blob, ext, { openPdf, signal } = {}) {
  const kind = readableKind(ext);
  if (kind === 'pdf') {
    const doc = await openPdf(blob);
    try {
      const pages = [];
      let chars = 0;
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES) && chars < MAX_CHARS; n++) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const page = await doc.getPage(n);
        const tc = await page.getTextContent();
        const text = tc.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
        page.cleanup();
        chars += text.length;
        pages.push(text);
      }
      return pages;
    } finally { doc.destroy?.(); }
  }
  if (kind === 'office') {
    const zip = await readZip(blob);
    const pick = (re) => zip.names.filter((n) => re.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (ext === 'docx') return [docxText(await zip.text('word/document.xml', MAX_CHARS * 2))];
    if (ext === 'xlsx') {
      const shared = zip.has('xl/sharedStrings.xml') ? await zip.text('xl/sharedStrings.xml', MAX_CHARS * 2) : '';
      const sheets = [];
      for (const n of pick(/^xl\/worksheets\/sheet\d+\.xml$/).slice(0, 30)) sheets.push(await zip.text(n, MAX_CHARS));
      return [xlsxText(shared, sheets)];
    }
    if (ext === 'pptx') {
      const slides = [];
      for (const n of pick(/^ppt\/slides\/slide\d+\.xml$/).slice(0, 300)) slides.push(pptxText(await zip.text(n, 2e6)));
      return slides.length ? slides : [''];
    }
    return [odfText(await zip.text('content.xml', MAX_CHARS * 2))];   // odt, ods, odp
  }
  if (kind === 'text') {
    const text = await blob.slice(0, 2e6).text();
    return [(ext === 'html' || ext === 'htm' ? htmlText(text) : text).slice(0, MAX_CHARS)];
  }
  throw new Error('No text to read in this kind of file.');
}

export class TextIndex {
  constructor() { this.mem = new Map(); this.failed = new Map(); this.looked = new Set(); this.db = null; this.ready = this.open(); }

  async open() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'ident' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch { this.db = null; }   // private window: the text is kept for this visit only
  }

  /** Bring what was read on an earlier visit into memory, for these idents. Resolves how many were found. */
  async load(idents) {
    await this.ready;
    if (!this.db) return 0;
    const need = idents.filter((i) => i && !this.mem.has(i) && !this.failed.has(i) && !this.looked.has(i));
    for (const i of need) this.looked.add(i);   // asked once per visit: a file not found now is not asked for again
    let found = 0;
    await Promise.all(need.map((ident) => new Promise((resolve) => {
      const req = this.db.transaction(STORE).objectStore(STORE).get(ident);
      req.onsuccess = () => {
        const r = req.result;
        if (r && r.failed) { if (Date.now() - r.at < RETRY_FAILED_AFTER) this.failed.set(ident, r.why || ''); }
        else if (r) { this.mem.set(ident, prepare(r.pages)); found++; }
        resolve();
      };
      req.onerror = () => resolve();
    })));
    return found;
  }

  /** The searchable entry for a file's content, or undefined. */
  get(ident) { return this.mem.get(ident); }
  /** 'ready' | 'failed' | 'none' */
  state(ident) { return this.mem.has(ident) ? 'ready' : this.failed.has(ident) ? 'failed' : 'none'; }

  put(ident, record) {
    if (!this.db) return;
    try { this.db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ident, at: Date.now(), ...record }); } catch { /* full or closed: it is read again next time */ }
  }

  /**
   * Read the text of these files, two at a time. list: [{ident, file}] (one per content). Files already read are skipped.
   * onProgress(done, total). Resolves {read, failed, stopped}.
   */
  async read(list, { source, signal, onProgress }) {
    const todo = list.filter((x) => x.ident && this.state(x.ident) === 'none');
    let done = 0, read = 0, failed = 0;
    const one = async (x) => {
      try {
        const blob = await source.blob(x.file, { signal });
        const pages = await extractPages(blob, x.file.ext, { openPdf: source.openPdf, signal });
        this.mem.set(x.ident, prepare(pages));
        this.put(x.ident, { pages });
        read++;
      } catch (e) {
        if (e?.name === 'AbortError') return;
        this.failed.set(x.ident, String(e?.message || e));
        this.put(x.ident, { pages: [], failed: true, why: String(e?.message || e).slice(0, 200) });
        failed++;
      }
    };
    for (let i = 0; i < todo.length && !signal?.aborted; i += 2) {
      await Promise.all(todo.slice(i, i + 2).map(one));
      done = Math.min(todo.length, i + 2);
      onProgress?.(done, todo.length);
    }
    return { read, failed, stopped: !!signal?.aborted };
  }
}
