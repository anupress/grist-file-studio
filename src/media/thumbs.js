// Thumbnails, made in the browser and kept in it.
//
// Grist has no thumbnail endpoint: a tile of a 6 MB phone photo would otherwise download 6 MB, and a
// wall of 300 such photos 1.8 GB on every visit. So each file is fetched once, drawn small into a
// canvas, and the small WebP is kept in IndexedDB under the file's content hash (Grist's fileIdent),
// which can never belong to another file. The second visit draws from the browser's own storage.
//
//   - At most four files download at a time, newest request first (what scrolled into view last is
//     what the person is looking at). A request nobody wants any more is dropped before it starts.
//   - Pictures: decoded with createImageBitmap, which applies EXIF rotation; the decoded size is
//     remembered, because Grist's imageWidth/imageHeight are the stored pixels (M0).
//   - PDFs: the first page through pdf.js (loaded on demand), plus the page count.
//   - Videos: the first frame, through a <video> streaming the file, stopped right after; plus the length.
//   - Text: the first lines, shown as a page preview; audio: its length.
//   - Anything else: nothing to fetch, the tile is drawn from the type alone.

import { decodeBitmap } from './picture.js';

const DB_NAME = 'file-studio-thumbs';
const STORE = 'thumbs';
const MAX_FILE = { image: 60e6, pdf: 80e6, text: 256e3, svg: 3e6 };
const PARALLEL = 4;
const MEMORY_ITEMS = 700;

export const tierOf = (cssPx, dpr = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)) => (cssPx * dpr <= 380 ? 360 : 720);

// ---- IndexedDB, best effort: a private window or blocked storage just means no second-visit speed-up.
let dbP = null;
function db() {
  if (!dbP) {
    dbP = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbP;
}
async function dbGet(key) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function dbPut(key, value) {
  const d = await db();
  if (!d) return;
  try { d.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key); } catch { /* full or blocked: fine */ }
}

/** Draw a bitmap or a canvas so its shorter side is `px` (the longer side at most 3 × px). */
function scaledCanvas(src, w, h, px) {
  const s = Math.min(1, px / Math.min(w, h), (px * 3) / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const toWebp = (canvas) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', 0.82));

function waitFor(el, ok, bad, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, ms);
    const yes = () => { cleanup(); resolve(); };
    const no = () => { cleanup(); reject(new Error('media error')); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(ok, yes); el.removeEventListener(bad, no); };
    el.addEventListener(ok, yes, { once: true });
    el.addEventListener(bad, no, { once: true });
  });
}

/**
 * @param source {blob(file, {type, signal}) -> Blob, url(file, {inline}) -> string, openPdf(blob)}
 * @param onAspect (ident, aspect) when a picture's real shape differs from what Grist said
 */
export function createThumbs(source, { onAspect = null } = {}) {
  const memory = new Map();        // key -> result, most recently used last
  const aspects = new Map();       // ident -> width / height as decoded
  const queue = [];                // jobs not started, newest last
  const jobs = new Map();          // key -> {file, px, wants: Set, ctrl, started}
  let running = 0;

  function remember(key, result) {
    memory.delete(key);
    memory.set(key, result);
    while (memory.size > MEMORY_ITEMS) {
      const [oldKey, old] = memory.entries().next().value;
      memory.delete(oldKey);
      if (old.url && !old.shared) URL.revokeObjectURL(old.url);
    }
  }
  function noteAspect(file, w, h) {
    if (!(w > 0 && h > 0) || !file.ident) return;
    const a = w / h;
    const was = file.w > 0 && file.h > 0 ? file.w / file.h : null;
    aspects.set(file.ident, a);
    if (was == null || Math.abs(Math.log(a / was)) > 0.05) onAspect?.(file.ident, a);
  }

  async function make(file, px, signal) {
    const kind = file.ext === 'svg' ? 'svg' : file.kind;
    if (kind === 'svg') {
      if (file.size > MAX_FILE.svg) return { failed: true };
      // An SVG is drawn by <img>, where its scripts never run; the file itself is the thumbnail.
      const blob = await source.blob(file, { type: 'image/svg+xml', signal });
      return { blob, w: file.w, h: file.h, keep: false };
    }
    if (kind === 'image' || kind === 'heic') {
      if (file.size > MAX_FILE.image) return { failed: true };
      const blob = await source.blob(file, { signal });
      let bmp;
      try { bmp = await decodeBitmap(blob); }   // HEIC too: the browser's own decoder, or libheif
      catch { return { failed: true, undecodable: true }; }   // a broken file
      const c = scaledCanvas(bmp, bmp.width, bmp.height, px);
      const out = { blob: await toWebp(c), w: bmp.width, h: bmp.height };
      bmp.close?.();
      return out;
    }
    if (kind === 'pdf') {
      if (file.size > MAX_FILE.pdf) return { failed: true };
      const blob = await source.blob(file, { signal });
      const doc = await source.openPdf(blob);
      try {
        const canvas = document.createElement('canvas');
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const scale = Math.min(3, px / Math.min(vp.width, vp.height));
        const v2 = page.getViewport({ scale });
        canvas.width = Math.round(v2.width); canvas.height = Math.round(v2.height);
        // intent 'print': the display intent paces itself by requestAnimationFrame, which never fires
        // while the page is hidden (a widget in a background tab), and the thumbnail would wait forever.
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: v2, background: '#ffffff', intent: 'print' }).promise;
        return { blob: await toWebp(canvas), w: vp.width, h: vp.height, extra: { pages: doc.numPages } };
      } finally { doc.destroy(); }
    }
    if (kind === 'video') {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.playsInline = true;
      v.src = await source.url(file, { inline: true });
      try {
        await waitFor(v, 'loadeddata', 'error');
        const c = scaledCanvas(v, v.videoWidth, v.videoHeight, px);
        return { blob: await toWebp(c), w: v.videoWidth, h: v.videoHeight, extra: { duration: v.duration } };
      } finally { v.removeAttribute('src'); v.load(); }
    }
    if (kind === 'audio') {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.src = await source.url(file, { inline: true });
      try { await waitFor(a, 'loadedmetadata', 'error'); return { extra: { duration: a.duration } }; }
      finally { a.removeAttribute('src'); a.load(); }
    }
    if (kind === 'text') {
      if (file.size > MAX_FILE.text) return { extra: { text: null } };
      const blob = await source.blob(file, { signal });
      const text = (await blob.text()).slice(0, 1600);
      return { extra: { text } };
    }
    return { failed: true };
  }

  function finish(key, job, result) {
    jobs.delete(key);
    remember(key, result);
    for (const cb of job.wants) { try { cb(result); } catch { /* a tile gone */ } }
  }

  async function run(job) {
    const key = job.key;
    running++;
    job.started = true;
    try {
      const stored = await dbGet(key);
      let result;
      if (stored) {
        result = { ...stored, url: stored.blob ? URL.createObjectURL(stored.blob) : null };
      } else {
        const made = await make(job.file, job.px, job.ctrl.signal);
        result = { ...made, url: made.blob ? URL.createObjectURL(made.blob) : null };
        if (!made.failed && made.keep !== false) dbPut(key, { blob: made.blob || null, w: made.w || 0, h: made.h || 0, extra: made.extra || null, t: Date.now() });
      }
      if (result.w && result.h) noteAspect(job.file, result.w, result.h);
      finish(key, job, result);
    } catch (e) {
      if (e?.name === 'AbortError') jobs.delete(key);
      else finish(key, job, { failed: true, error: String(e?.message || e) });
    } finally {
      running--;
      pump();
    }
  }

  function pump() {
    while (running < PARALLEL && queue.length) {
      const job = queue.pop();
      if (!job.wants.size) { jobs.delete(job.key); continue; }
      run(job);
    }
  }

  return {
    aspects,
    /**
     * Ask for a file's thumbnail at about `cssPx`. `cb` gets {url, w, h, extra, failed}. Returns a
     * function that withdraws the request (call it when the tile leaves the screen).
     */
    want(file, cssPx, cb) {
      const px = tierOf(cssPx);
      const key = `${file.ident || 'att' + file.attId}@${px}`;
      const hit = memory.get(key);
      if (hit) { remember(key, hit); cb(hit); return () => {}; }
      let job = jobs.get(key);
      if (!job) {
        job = { key, file, px, wants: new Set(), ctrl: new AbortController(), started: false };
        jobs.set(key, job);
        queue.push(job);
      } else if (!job.started) {
        // Asked again: move it to the front of the line.
        const at = queue.indexOf(job);
        if (at >= 0) { queue.splice(at, 1); queue.push(job); }
      }
      job.wants.add(cb);
      pump();
      return () => {
        job.wants.delete(cb);
        if (!job.wants.size && job.started && job.file.size > 2e6) job.ctrl.abort();
      };
    },
    /** What is known about a file without waiting (from memory), or null. */
    peek(file, cssPx) { return memory.get(`${file.ident || 'att' + file.attId}@${tierOf(cssPx)}`) || null; },
    /** Drop the in-memory copies (the stored ones stay). */
    clear() { for (const r of memory.values()) if (r.url) URL.revokeObjectURL(r.url); memory.clear(); },
  };
}
