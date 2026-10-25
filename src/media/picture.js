// Pictures the browser may not decode: HEIC and HEIF, what iPhones take. Safari draws them; Chrome, Edge and Firefox cannot.
//
// decodeBitmap() is createImageBitmap() that also reads HEIC: the browser's own decoder first, then libheif (vendor/libheif/, in a worker,
// loaded the first time a HEIC file turns up; about 2 MB). heicJpeg() makes a JPEG of one, for showing it and for converting it.
// Nothing leaves the browser.

const base = () => new URL('vendor/libheif/', document.baseURI).href;
const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);   // 'avif' is left to the browser

/** Is this (the first bytes of) a HEIC or HEIF file? Looks at the 'ftyp' box, not at the name. */
export function isHeicBytes(bytes) {
  if (!bytes || bytes.length < 12) return false;
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) !== 'ftyp') return false;
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (BRANDS.has(brand)) return true;
  // a compatible brand further on in the box (an iPhone file says mif1 first, but another writer may not)
  const size = Math.min(bytes.length, ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
  for (let i = 16; i + 4 <= size; i += 4) if (BRANDS.has(String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]))) return true;
  return false;
}
export async function isHeic(blob) { return isHeicBytes(new Uint8Array(await blob.slice(0, 64).arrayBuffer())); }

// ---- the worker: one, jobs one after the other (libheif holds a lot of memory while it works) ----
let worker = null, nextId = 1, chain = Promise.resolve();
const pending = new Map();

function start() {
  if (worker) return worker;
  worker = new Worker(base() + 'heic-worker.mjs', { type: 'module' });
  worker.onmessage = (e) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    clearTimeout(job.timer);
    if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The HEIC reader could not be loaded.');
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(err); }
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** @returns Promise<{width, height, data: ArrayBuffer}> the first picture of a HEIC file as RGBA */
export function decodeHeic(blob) {
  const run = async () => {
    const buffer = await blob.arrayBuffer();
    const w = start();
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Reading this picture took too long.')); w.terminate(); if (worker === w) worker = null; }, 90000);
      pending.set(id, { resolve: (d) => resolve({ width: d.width, height: d.height, data: d.buffer }), reject, timer });
      w.postMessage({ id, buffer }, [buffer]);
    });
  };
  const job = chain.then(run, run);
  chain = job.catch(() => {});
  return job;
}

/** createImageBitmap that also reads HEIC. Throws the browser's own error for anything else it cannot decode. */
export async function decodeBitmap(blob, options) {
  try { return await createImageBitmap(blob, options); }
  catch (e) {
    if (!(await isHeic(blob))) throw e;
    const { width, height, data } = await decodeHeic(blob);
    return createImageBitmap(new ImageData(new Uint8ClampedArray(data), width, height));
  }
}

/** A JPEG of a picture (a HEIC file, or any picture the browser decodes): at most maxSide px on the long side when given. */
export async function heicJpeg(blob, { quality = 0.92, maxSide = 0 } = {}) {
  const bmp = await decodeBitmap(blob);
  try {
    const k = maxSide ? Math.min(1, maxSide / Math.max(bmp.width, bmp.height)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', quality));
    c.width = c.height = 0;
    if (!out) throw new Error('The picture could not be saved as a JPEG.');
    return out;
  } finally { bmp.close?.(); }
}

// ---- a picture to show: HEIC files are shown as a JPEG made in the browser, kept for a while ----
const shown = new Map();   // key -> {url, at}
/** An object URL for a file's picture. HEIC and HEIF become a JPEG; every other kind keeps its own URL (the caller's `fallback`). */
export async function shownUrl(file, source, { signal } = {}) {
  const key = file.ident || 'att' + file.attId;
  const had = shown.get(key);
  if (had) return had.url;
  const blob = await source.blob(file, { signal });
  const url = URL.createObjectURL(await heicJpeg(blob, { maxSide: 4096 }));
  shown.set(key, { url, at: Date.now() });
  // keep the last few: a lightbox steps back and forth
  if (shown.size > 12) { const oldest = [...shown].sort((a, b) => a[1].at - b[1].at)[0]; URL.revokeObjectURL(oldest[1].url); shown.delete(oldest[0]); }
  return url;
}
