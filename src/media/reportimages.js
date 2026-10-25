// Pictures for a report: each one decoded, turned the way it was shot, drawn on white, made at most `maxSide` pixels on its
// long side and encoded as a JPEG. A report of 40 phone photos would otherwise be 150 MB.

import { decodeBitmap } from './picture.js';

/** The pictures a report can draw: what the browser decodes and pdf-lib can take after a redraw. HEIC, SVG and the rest are listed instead. */
export const REPORT_PICTURE = /^(jpe?g|jfif|pjpeg|png|webp|bmp|gif|avif|heic|heif)$/;

/**
 * @param files [{name, ext, ...}] with the source's blob(file, {signal})
 * @param o {source, maxSide, quality, signal, onProgress(done, total)}
 * @returns {Promise<{images: ({bytes: Uint8Array, type: 'jpg', w: number, h: number} | null)[]}>} null where a picture could not be read
 */
export async function prepareImages(files, { source, maxSide = 1600, quality = 0.82, signal, onProgress }) {
  const images = new Array(files.length).fill(null);
  let next = 0, done = 0;
  const one = async (f) => {
    const blob = await source.blob(f, { signal });
    const bmp = await decodeBitmap(blob, { imageOrientation: 'from-image' });   // the EXIF turn is applied: the picture is the way it was held
    try {
      const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);   // transparency becomes white, not black
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
      if (!out) throw new Error('The picture could not be redrawn.');
      return { bytes: new Uint8Array(await out.arrayBuffer()), type: 'jpg', w: c.width, h: c.height };
    } finally { bmp.close?.(); }
  };
  const work = async () => {
    while (next < files.length && !signal?.aborted) {
      const k = next++;
      try { images[k] = await one(files[k]); } catch (e) { if (e?.name === 'AbortError') return; images[k] = null; }
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all([work(), work()]);
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  return { images };
}
