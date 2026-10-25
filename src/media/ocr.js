// Text recognition (OCR): the words in scanned PDF pages and in pictures, read by tesseract.js in a worker in this browser.
//
// About 13 MB of engine and language data sit in vendor/tesseract/ and are fetched the first time something needs reading (the
// browser keeps them after that); nothing is sent anywhere. The reader is started when the first scanned page turns up and stopped
// when the run ends, so a run that finds nothing to recognise never loads it.

import { uiLang } from '../i18n/index.js';

const base = () => new URL('vendor/tesseract/', document.baseURI).href;
const MIN_CONFIDENCE = 50;     // below this the whole page is taken for noise (a photo of a building "reads" as nonsense)
const PAGE_SIDE = 2000;        // px: a PDF page is drawn with its long side this long (A4 at about 170 dpi) before it is read
const PICTURE_SIDE = 2400;     // px: a larger picture is reduced to this

/** WebAssembly SIMD, which the faster reader needs (every browser of the last few years has it). */
function hasSimd() {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; }
}

/** The languages to read with: the interface language (the one most likely in the files) and English. */
export function ocrLanguages(ui = uiLang()) { return [...new Set([{ de: 'deu', fr: 'fra' }[ui] || 'eng', 'eng'])]; }

/** Tidy what the reader returned: no runs of spaces, no stacks of empty lines. */
export function tidyText(s) { return String(s || '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }

/**
 * A reader of pages and pictures that starts itself on first use. Call stop() when the run is over.
 * @returns {{page(doc, n): Promise<string>, image(blob): Promise<string>, stop(): Promise<void>}}
 */
export function createReader({ languages = ocrLanguages(), signal } = {}) {
  let worker = null, starting = null, stopped = false;

  const start = () => {
    if (!starting) {
      starting = (async () => {
        const mod = await import(/* @vite-ignore */ base() + 'tesseract.esm.min.js');
        const lib = mod.createWorker ? mod : mod.default;
        const w = await lib.createWorker(languages, 1, {
          workerPath: base() + 'worker.min.js',
          corePath: base() + 'core/tesseract-core-' + (hasSimd() ? 'simd-' : '') + 'lstm.wasm.js',
          langPath: base() + 'lang', gzip: true, cacheMethod: 'none',
        });
        if (stopped) { await w.terminate(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
        worker = w;
        return w;
      })();
      starting.catch(() => { starting = null; });
    }
    return starting;
  };
  const read = async (canvas) => {
    const w = await start();
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { data } = await w.recognize(canvas);
    return data.confidence >= MIN_CONFIDENCE ? tidyText(data.text) : '';
  };
  const stop = async () => { stopped = true; try { const w = worker || (await starting?.catch(() => null)); worker = null; await w?.terminate(); } catch { /* already gone */ } };
  signal?.addEventListener('abort', () => { stop(); }, { once: true });

  return {
    /** The words on page n (1-based) of a pdf.js document, drawn first. */
    async page(doc, n) {
      const page = await doc.getPage(n);
      try {
        const unit = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(4, Math.max(1, PAGE_SIDE / Math.max(unit.width, unit.height))) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, background: '#ffffff', intent: 'print' }).promise;
        const text = await read(canvas);
        canvas.width = canvas.height = 0;
        return text;
      } finally { page.cleanup(); }
    },
    /** The words in a picture (a Blob the browser can decode). */
    async image(blob) {
      const bmp = await createImageBitmap(blob);
      try {
        const k = Math.min(1, PICTURE_SIDE / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bmp.width * k)); canvas.height = Math.max(1, Math.round(bmp.height * k));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const text = await read(canvas);
        canvas.width = canvas.height = 0;
        return text;
      } finally { bmp.close?.(); }
    },
    stop,
  };
}
