// When each photo was taken, read once from the start of the file and kept in this browser under the file's content hash, like the
// text of documents (media/textindex.js): the same photo in two records is read once, nothing goes into the document, and a photo that
// has no EXIF is remembered as having none. Used to sort by date taken and to fill in a photo's details.

import { parseAnyExif } from './exif.js';

const DB_NAME = 'file-studio-exif';
const STORE = 'photos';
export const HEAD_BYTES = 128 * 1024;
export const HEIC_HEAD_BYTES = 640 * 1024;   // a HEIC keeps its EXIF block as an item inside the file, not always at the very start
const JPEG = /^(jpe?g|jfif|pjpeg)$/;
const HEIC = /^(heic|heif)$/;

/** Can a date be read from this file? JPEGs and HEIC pictures carry EXIF in a place we read. */
export const hasExif = (f) => JPEG.test(f.ext || '') || HEIC.test(f.ext || '');

export class ExifIndex {
  constructor() { this.mem = new Map(); this.looked = new Set(); this.db = null; this.ready = this.open(); }

  async open() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'ident' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch { this.db = null; }   // a private window: kept for this visit only
  }

  /** Bring what was read on an earlier visit into memory, for these idents. Resolves how many were found. */
  async load(idents) {
    await this.ready;
    if (!this.db) return 0;
    const need = idents.filter((i) => i && !this.mem.has(i) && !this.looked.has(i));
    for (const i of need) this.looked.add(i);
    let found = 0;
    await Promise.all(need.map((ident) => new Promise((resolve) => {
      const req = this.db.transaction(STORE).objectStore(STORE).get(ident);
      req.onsuccess = () => { if (req.result) { this.mem.set(ident, req.result.info); found++; } resolve(); };
      req.onerror = () => resolve();
    })));
    return found;
  }

  /** What was read: the info object, null for "read, and there is nothing", undefined for "not read yet". */
  get(ident) { return this.mem.get(ident); }
  has(ident) { return this.mem.has(ident); }

  set(ident, info) {
    this.mem.set(ident, info);
    if (!this.db) return;
    try { this.db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ident, at: Date.now(), info }); } catch { /* full or closed: it is read again next time */ }
  }

  /** Read one photo's EXIF through source.head(file, n). Resolves the info or null. */
  async readOne(ident, file, source, signal) {
    const bytes = await source.head(file, HEIC.test(file.ext || '') ? HEIC_HEAD_BYTES : HEAD_BYTES, { signal });
    const p = parseAnyExif(bytes);
    const info = p ? { taken: p.taken, make: p.make, model: p.model, orientation: p.orientation, lat: p.lat, lon: p.lon, altitude: p.altitude } : null;
    this.set(ident, info);
    return info;
  }

  /**
   * Read these photos, four at a time. list: [{ident, file}] (one per content). Files already read are skipped.
   * Resolves {read, failed, stopped}.
   */
  async read(list, { source, signal, onProgress }) {
    const todo = list.filter((x) => x.ident && !this.mem.has(x.ident));
    let next = 0, done = 0, read = 0, failed = 0;
    const work = async () => {
      while (next < todo.length && !signal?.aborted) {
        const x = todo[next++];
        try { await this.readOne(x.ident, x.file, source, signal); read++; }
        catch (e) { if (e?.name === 'AbortError') return; failed++; }
        onProgress?.(++done, todo.length);
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    return { read, failed, stopped: !!signal?.aborted };
  }
}
