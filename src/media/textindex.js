// The text of the files, read once and kept in this browser so that a search can look inside them.
//
// What is read: PDFs (page by page with pdf.js), text files, HTML, and Word, Excel, PowerPoint and OpenDocument files
// (zip files with XML inside, see unzip.js). Pictures, video and audio have no text to read. Each file is read when asked
// and kept under its content hash (fileIdent), like the thumbnails, so the same file in two records is read once and a
// changed file is a new one. The text is kept in IndexedDB in THIS browser and nowhere else: never in the document.
//
// A PDF page with no text (a scan) is noted. When the person has allowed it, such pages, and pictures, are read by text recognition
// (media/ocr.js); the reader is handed in, so this file draws nothing and the tests need no canvas.

import { readZip } from './unzip.js';
import { docxText, pptxText, odfText, xlsxText, htmlText } from './officetext.js';
import { prepare } from '../model/textsearch.js';
import { kindOf } from '../model/kinds.js';

const DB_NAME = 'file-studio-text';
const STORE = 'docs';
const RETRY_FAILED_AFTER = 7 * 24 * 3600 * 1000;   // a file that could not be read is tried again after a week
const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
const LIMITS = { pdf: 80e6, office: 30e6, text: 5e6, image: 30e6 };   // bytes worth fetching for the text of one file
const MAX_PDF_PAGES = 500;
const MAX_CHARS = 2.5e6;                                  // of text kept for one file
const SCANNED_BELOW = 20;                                 // a PDF page with fewer characters than this is taken for a scan
const IMAGE = /^(jpe?g|jfif|pjpeg|png|webp|bmp|gif|avif|heic|heif)$/;

/** 'pdf' | 'office' | 'text' for a file whose text can be read, 'image' for a picture when pictures are to be read by text recognition, else null. */
export function readableKind(ext, kind = kindOf(ext), { pictures = false } = {}) {
  if (ext === 'pdf') return 'pdf';
  if (OFFICE.has(ext)) return 'office';
  if (kind === 'text') return 'text';
  return pictures && IMAGE.test(ext) ? 'image' : null;
}
export const canRead = (f, o = {}) => { const k = readableKind(f.ext, f.kind, o); return !!k && f.size <= LIMITS[k]; };

/** The text of a file, as an array of pages. Throws when the file cannot be read. */
export async function extractPages(blob, ext, o = {}) { return (await extractDetailed(blob, ext, o)).pages; }

/**
 * The text of a file with what is known about scans: {pages, scanned: [1-based pages with no text of their own], recognised: how many of
 * those (or of a picture) the text recognition read}. `ocr` ({page(doc, n), image(blob)}) is given only when recognition is allowed;
 * onPage(n, total) tells which scanned page it is working on.
 */
export async function extractDetailed(blob, ext, { openPdf, signal, ocr = null, onPage = null, pictures = false } = {}) {
  const kind = readableKind(ext, kindOf(ext), { pictures: pictures || !!ocr });
  if (kind === 'image') {
    if (!ocr) throw new Error('No text to read in this kind of file.');
    const text = await ocr.image(blob);
    return { pages: [text], scanned: [1], recognised: text ? 1 : 0 };
  }
  if (kind === 'pdf') {
    const doc = await openPdf(blob);
    try {
      const pages = [], scanned = [];
      let chars = 0, recognised = 0;
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES) && chars < MAX_CHARS; n++) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const page = await doc.getPage(n);
        const tc = await page.getTextContent();
        let text = tc.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
        page.cleanup();
        if (text.length < SCANNED_BELOW) {
          scanned.push(n);
          if (ocr) {
            onPage?.(n, doc.numPages);
            const read = await ocr.page(doc, n);
            if (read) { text = read; recognised++; }
          }
        }
        chars += text.length;
        pages.push(text);
      }
      return { pages, scanned, recognised };
    } finally { doc.destroy?.(); }
  }
  return { pages: await extractOther(blob, ext, kind), scanned: [], recognised: 0 };
}

async function extractOther(blob, ext, kind) {
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

/** The notes about scans an entry carries: which pages had no text, whether recognition has run on the file, how many pages it read. */
function withScans(entry, rec) {
  entry.scanned = Array.isArray(rec.scanned) ? rec.scanned : [];
  entry.ocrRan = !!rec.ocrRan;
  entry.recognised = rec.recognised || 0;
  return entry;
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
        else if (r) { this.mem.set(ident, withScans(prepare(r.pages), r)); found++; }
        resolve();
      };
      req.onerror = () => resolve();
    })));
    return found;
  }

  /** How many pages of this file are scans that text recognition has not read (0 when it has run, or there are none). */
  scansLeft(ident) { const e = this.mem.get(ident); return e && !e.ocrRan ? e.scanned.length : 0; }

  /** The searchable entry for a file's content, or undefined. */
  get(ident) { return this.mem.get(ident); }
  /** 'ready' | 'failed' | 'none' */
  state(ident) { return this.mem.has(ident) ? 'ready' : this.failed.has(ident) ? 'failed' : 'none'; }

  put(ident, record) {
    if (!this.db) return;
    try { this.db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ident, at: Date.now(), ...record }); } catch { /* full or closed: it is read again next time */ }
  }

  /**
   * Read the text of these files, two at a time. list: [{ident, file}] (one per content). Files already read are skipped, except (with
   * `ocr`, the text recognition) the ones that have scanned pages it has not read yet. onProgress(done, total); onPage(n, total) while
   * a scanned page is being recognised (then one file at a time: the reader is one worker). Resolves {read, failed, stopped, recognised}.
   */
  async read(list, { source, signal, onProgress, ocr = null, onPage = null }) {
    const todo = list.filter((x) => x.ident && (this.state(x.ident) === 'none' || (ocr && this.scansLeft(x.ident))));
    let done = 0, read = 0, failed = 0, recognised = 0;
    const one = async (x) => {
      try {
        const blob = await source.blob(x.file, { signal });
        const got = await extractDetailed(blob, x.file.ext, { openPdf: source.openPdf, signal, ocr, onPage });
        const rec = { pages: got.pages, scanned: got.scanned, ocrRan: !!ocr, recognised: got.recognised };
        this.mem.set(x.ident, withScans(prepare(got.pages), rec));
        this.put(x.ident, rec);
        recognised += got.recognised;
        read++;
      } catch (e) {
        if (e?.name === 'AbortError') return;
        this.failed.set(x.ident, String(e?.message || e));
        this.put(x.ident, { pages: [], failed: true, why: String(e?.message || e).slice(0, 200) });
        failed++;
      }
    };
    // With recognition on, one file at a time: its pages go through one worker anyway, and the progress then says which page.
    const step = ocr ? 1 : 2;
    for (let i = 0; i < todo.length && !signal?.aborted; i += step) {
      await Promise.all(todo.slice(i, i + step).map(one));
      done = Math.min(todo.length, i + step);
      onProgress?.(done, todo.length);
    }
    return { read, failed, stopped: !!signal?.aborted, recognised };
  }
}
