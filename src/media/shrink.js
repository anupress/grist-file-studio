// Making large photos smaller before they are uploaded (an option, off by default).
//
// A phone photo is 3–8 MB at 4000 px; a document seldom needs more than 2560 px. Redrawing it also
// drops everything the camera wrote into the file, including where the photo was taken: worth saying
// in the option's description, since many people would want that anyway. PNGs keep their
// transparency (re-encoded as PNG); everything else becomes a JPEG at 85 %. A file the browser cannot
// decode (HEIC on Chrome) is uploaded as it is.

import { extOf, baseOf } from '../model/kinds.js';

const SHRINKABLE = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'bmp', 'heic', 'heif'];

/** @returns {Promise<File>} the smaller file, or the same file when there is nothing to gain */
export async function shrinkPhoto(file, maxSide = 2560, quality = 0.85) {
  const ext = extOf(file.name);
  if (!SHRINKABLE.includes(ext)) return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  try {
    const { width: w, height: h } = bmp;
    if (Math.max(w, h) <= maxSide && file.size < 1.5e6) return file;
    const s = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const png = ext === 'png';
    const blob = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], baseOf(file.name) + (png ? '.png' : '.jpg'), { type: blob.type, lastModified: file.lastModified });
  } finally { bmp.close?.(); }
}
