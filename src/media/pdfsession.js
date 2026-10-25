// What the PDF editor works on: pdf-lib for writing, pdf.js for showing, and the files they share.
//
// A "source" is one file the editor takes pages from: the PDF being edited, or a PDF or photo added to it.
// Photos become one-page PDFs on the way in (turned upright, shrunk to a sensible size), so from here on
// every source is a PDF. Nothing in this file touches the widget's DOM.

import { openPdf } from './pdf.js';
import { openDocument, imageToPdf, hasSignature } from './pdfops.js';

let libPromise = null;
/** The vendored pdf-lib bundle, fetched the first time a PDF is edited. */
export function loadPdfLib() {
  if (!libPromise) {
    // A computed URL, so the bundler leaves this import alone and the browser fetches it at run time.
    const url = new URL('vendor/pdflib/pdflib.mjs', document.baseURI).href;
    libPromise = import(/* @vite-ignore */ url);
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

const MAX_PHOTO_SIDE = 2600;   // pixels: more than a page can show, far less than a phone camera makes

/** A photo as JPEG (or PNG when it is a PNG) bytes, upright, no larger than MAX_PHOTO_SIDE. */
export async function photoBytes(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_PHOTO_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const png = /png$/i.test(blob.type);
  if (!png) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, png ? 'image/png' : 'image/jpeg', 0.9));
  if (!out) throw new Error('This browser cannot read the picture.');
  return { bytes: new Uint8Array(await out.arrayBuffer()), type: png ? 'png' : 'jpeg', width: w, height: h };
}

const IMAGE_EXT = /\.(jpe?g|jfif|png|webp|gif|bmp|avif)$/i;
export const isPhoto = (blob, name) => /^image\//.test(blob.type || '') || IMAGE_EXT.test(name || '');

/**
 * The sources of one editing session. add() resolves a source:
 *   {id, name, bytes, doc (pdf.js), count, sizes: [{w, h}] (display size of each page, in points), password, signed, photo}
 * `askPassword(wrong)` is called for a protected file and resolves the password or null to give up.
 */
export class Sources {
  constructor(lib) { this.lib = lib; this.map = new Map(); this.n = 0; }

  get(id) { return this.map.get(id); }
  all() { return [...this.map.values()]; }

  async add(name, blob, askPassword) {
    const id = 's' + (this.n++);
    let bytes, photo = false;
    if (isPhoto(blob, name)) {
      const p = await photoBytes(blob);
      bytes = await imageToPdf(this.lib, p.bytes, p.type, p.width, p.height);
      photo = true;
    } else {
      bytes = new Uint8Array(await blob.arrayBuffer());
    }
    let password = null, doc = null;
    while (!doc) {
      try {
        doc = await openPdf(bytes, { password });
      } catch (e) {
        if (e?.name !== 'PasswordException') throw e;
        password = await askPassword(e.code === 2);   // code 2: the one given was wrong
        if (password == null) throw Object.assign(new Error('cancelled'), { cancelled: true });
      }
    }
    // pdf-lib must be able to write what pdf.js can show; this also checks the password once.
    try { await openDocument(this.lib, bytes, password); } catch (e) { doc.destroy(); throw e; }
    const sizes = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
      sizes.push({ w: vp.width, h: vp.height });
    }
    const src = { id, name, bytes, doc, count: doc.numPages, sizes, password, signed: !photo && hasSignature(bytes), photo };
    this.map.set(id, src);
    return src;
  }

  /** A fresh pdf-lib document of a source, for buildPdf(). */
  load = (id) => {
    const s = this.map.get(id);
    return openDocument(this.lib, s.bytes, s.password);
  };

  destroy() { for (const s of this.map.values()) s.doc.destroy(); this.map.clear(); }
}
