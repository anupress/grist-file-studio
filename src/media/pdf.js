// pdf.js, loaded only when a PDF is on screen.
//
// About 1.7 MB with its worker, so it is never part of the widget's own bundle: the first PDF
// thumbnail or page pulls it in from vendor/pdfjs/, and the browser keeps it cached after that.
// Scripting inside PDFs stays off (no sandbox file is shipped), and eval is not used.

let lib = null;

const base = () => new URL('vendor/pdfjs/', document.baseURI).href;

/** The pdf.js module. */
export function pdfjs() {
  if (!lib) {
    // A computed URL, so the bundler leaves this import alone and the browser fetches it at run time.
    const url = base() + 'pdf.min.mjs';
    lib = import(/* @vite-ignore */ url).then((m) => {
      m.GlobalWorkerOptions.workerSrc = base() + 'pdf.worker.min.mjs';
      return m;
    });
    lib.catch(() => { lib = null; });
  }
  return lib;
}

/**
 * Open a PDF from a Blob or its bytes. Remember to destroy() the document when done. A password-protected
 * file rejects with an error whose `name` is 'PasswordException' (code 1 needs one, 2 was wrong); call again
 * with `{password}`.
 */
export async function openPdf(blob, { password } = {}) {
  const m = await pdfjs();
  // pdf.js may hand the buffer to its worker, which empties it: always give it a copy.
  const data = blob instanceof Uint8Array ? blob.slice() : new Uint8Array(await blob.arrayBuffer());
  const task = m.getDocument({
    data,
    password: password || undefined,
    cMapUrl: base() + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base() + 'standard_fonts/',
    wasmUrl: base() + 'wasm/',
    iccUrl: base() + 'iccs/',
    isEvalSupported: false,
    enableXfa: false,
  });
  const doc = await task.promise;
  // pdf.js 6 frees a document through its loading task; the callers just call doc.destroy().
  if (typeof doc.destroy !== 'function') doc.destroy = () => task.destroy();
  return doc;
}

/**
 * Draw one page (1-based) into a canvas so that its width is `cssWidth` CSS pixels, sharp on this
 * screen. Returns the page's size in CSS pixels.
 */
export async function renderPage(doc, n, canvas, cssWidth, { dpr = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), rotation = 0, signal = null, intent = 'display' } = {}) {
  const page = await doc.getPage(n);
  const unit = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const scale = cssWidth / unit.width;
  const vp = page.getViewport({ scale: scale * dpr, rotation: (page.rotate + rotation) % 360 });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  canvas.style.width = Math.round(vp.width / dpr) + 'px';
  canvas.style.height = Math.round(vp.height / dpr) + 'px';
  const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, background: '#ffffff', intent });
  if (signal) signal.addEventListener('abort', () => task.cancel(), { once: true });
  await task.promise;
  page.cleanup();
  return { w: vp.width / dpr, h: vp.height / dpr };
}
