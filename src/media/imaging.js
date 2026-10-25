// The picture editor's arithmetic: tone and colour on pixels, auto levels, sharpening, pixelation,
// and the geometry of rotating, straightening and cropping. Pure: it works on {data, width, height}
// (an ImageData or anything shaped like one), so tests/imaging.test.mjs runs it in Node.
//
// Every slider runs from -100 to 100 with 0 meaning "unchanged", except exposure (-2 to +2 stops) and
// sharpness (0 to 100). A picture with every value at 0 comes out byte for byte the same.

export const ADJUST_DEFAULTS = Object.freeze({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, warmth: 0, sharpness: 0, levels: null });

/** True when the adjustments change nothing (so the pixel pass can be skipped). */
export const isIdentity = (a) => !a || (!a.exposure && !a.contrast && !a.highlights && !a.shadows && !a.saturation && !a.warmth && !a.sharpness && !a.levels);

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Three lookup tables (red, green, blue: value in -> value out) for the tone part: levels, exposure,
 * shadows, highlights, contrast, in that order.
 */
export function toneLuts(a) {
  const out = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  const gain = Math.pow(2, a.exposure || 0);
  const c = (a.contrast || 0) * 1.28;                       // -128..128
  const cf = (259 * (c + 255)) / (255 * (259 - c));          // the classic contrast factor
  const sh = (a.shadows || 0) / 100, hi = (a.highlights || 0) / 100;
  for (let ch = 0; ch < 3; ch++) {
    const lv = a.levels ? a.levels[ch] : null;
    for (let v = 0; v < 256; v++) {
      let x = v;
      if (lv && lv[1] > lv[0]) x = ((x - lv[0]) * 255) / (lv[1] - lv[0]);
      x = x * gain;
      let n = Math.min(1, Math.max(0, x / 255));
      // Shadows lift (or deepen) the dark half, highlights pull back (or push) the bright half; both
      // fade to nothing at the far end, so black stays black and white stays white.
      if (sh) n += sh * 0.9 * n * (1 - n) * (1 - n) * (1 - n);   // strongest at a quarter
      if (hi) n += hi * 0.9 * n * n * n * (1 - n);               // strongest at three quarters
      x = n * 255;
      if (c) x = cf * (x - 128) + 128;
      out[ch][v] = clamp255(Math.round(x));
    }
  }
  return out;
}

/**
 * Apply the adjustments to pixels, in place. Tone by lookup table, then saturation and warmth per
 * pixel, then sharpening. Alpha is left alone.
 */
export function applyAdjust(img, a) {
  if (isIdentity(a)) return img;
  const d = img.data;
  const [lr, lg, lb] = toneLuts(a);
  const sat = 1 + (a.saturation || 0) / 100;
  const warm = (a.warmth || 0) * 0.3;                       // up to ±30 levels of red against blue
  const colour = sat !== 1 || warm;
  for (let i = 0; i < d.length; i += 4) {
    let r = lr[d[i]], g = lg[d[i + 1]], b = lb[d[i + 2]];
    if (colour) {
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = L + (r - L) * sat + warm;
      g = L + (g - L) * sat + warm * 0.1;
      b = L + (b - L) * sat - warm;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;   // a Uint8ClampedArray rounds and clamps
  }
  if (a.sharpness) sharpen(img, a.sharpness);
  return img;
}

/**
 * Unsharp mask with a 3×3 box blur: each pixel moves away from its neighbourhood's average.
 * amount 0..100 (100 = one and a half times the difference). In place.
 */
export function sharpen(img, amount) {
  const { width: w, height: h, data: d } = img;
  if (w < 3 || h < 3 || !amount) return img;
  const k = (amount / 100) * 1.5;
  const src = new Uint8ClampedArray(d);
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const j = i + c;
        const avg = (src[j - row - 4] + src[j - row] + src[j - row + 4] + src[j - 4] + src[j] + src[j + 4] + src[j + row - 4] + src[j + row] + src[j + row + 4]) / 9;
        d[j] = src[j] + (src[j] - avg) * k;
      }
    }
  }
  return img;
}

/** Histogram of each channel: three Uint32Array(256). */
export function histogram(img) {
  const h = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { h[0][d[i]]++; h[1][d[i + 1]]++; h[2][d[i + 2]]++; }
  return h;
}

/**
 * Auto: each channel's darkest and brightest 0.5 % become black and white, which also takes out a
 * colour cast (a yellow indoor photo gets its blue back). Returns levels for the adjustments, or null
 * when the picture already spans the range.
 */
export function autoLevels(img, clip = 0.005) {
  const hist = histogram(img);
  const total = img.width * img.height;
  const levels = hist.map((hc) => {
    let lo = 0, hi = 255, acc = 0;
    for (; lo < 255; lo++) { acc += hc[lo]; if (acc > total * clip) break; }
    acc = 0;
    for (; hi > 0; hi--) { acc += hc[hi]; if (acc > total * clip) break; }
    if (hi - lo < 32) return [0, 255];        // a flat channel (a sky, a document) is left alone
    return [lo, hi];
  });
  return levels.every(([lo, hi]) => lo <= 2 && hi >= 253) ? null : levels;
}

export const LOOKS = Object.freeze({
  none: {},
  bw: { saturation: -100, contrast: 12 },
  warm: { warmth: 35, saturation: 8 },
  cool: { warmth: -35 },
  vivid: { contrast: 18, saturation: 35 },
  soft: { contrast: -15, highlights: -25, shadows: 20 },
});

/** Pixelate a rectangle (pixels), in place: each block of `cell` pixels takes its average colour. */
export function pixelate(img, rect, cell) {
  const { width: w, height: h, data: d } = img;
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(w, Math.ceil(rect.x + rect.w)), y1 = Math.min(h, Math.ceil(rect.y + rect.h));
  const s = Math.max(2, Math.round(cell));
  for (let by = y0; by < y1; by += s) {
    for (let bx = x0; bx < x1; bx += s) {
      let r = 0, g = 0, b = 0, n = 0;
      const ey = Math.min(y1, by + s), ex = Math.min(x1, bx + s);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      r /= n; g /= n; b /= n;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; }
    }
  }
  return img;
}

// ---- geometry ----------------------------------------------------------------------------------------

/** Width and height after quarter turns. */
export const turnedSize = (w, h, rot) => (rot % 180 ? [h, w] : [w, h]);

/**
 * How much a picture must grow when straightened by `deg` so that it still fills its own frame (no
 * empty corners): the scale of a w×h box rotated inside a w×h box.
 */
export function straightenScale(w, h, deg) {
  const a = Math.abs(deg * Math.PI / 180);
  if (!a) return 1;
  const c = Math.cos(a), s = Math.sin(a);
  return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
}

/**
 * A crop rectangle (fractions of the picture: x, y, w, h in 0..1) of the given aspect (width/height of
 * the result, or null for free), as large as fits, centred on the old one.
 */
export function cropToAspect(rect, aspect, picW, picH) {
  if (!aspect) return rect;
  const cw = rect.w * picW, ch = rect.h * picH;
  let w = cw, h = cw / aspect;
  if (h > ch) { h = ch; w = ch * aspect; }
  // Grow back towards the whole picture when the old rectangle was small in the other direction.
  const maxW = picW, maxH = picH;
  if (w < maxW && h < maxH) {
    const g = Math.min(maxW / w, maxH / h, Math.max(cw / w, ch / h));
    w *= g; h *= g;
  }
  const cx = (rect.x + rect.w / 2) * picW, cy = (rect.y + rect.h / 2) * picH;
  let x = cx - w / 2, y = cy - h / 2;
  x = Math.min(Math.max(0, x), picW - w);
  y = Math.min(Math.max(0, y), picH - h);
  return { x: x / picW, y: y / picH, w: w / picW, h: h / picH };
}

/**
 * Drag a crop handle. handle: 'n','s','e','w','ne','nw','se','sw' or 'move'; dx, dy in fractions of the
 * picture. Keeps the rectangle inside the picture and at least `min` (a fraction) in each direction;
 * with an aspect (of the picture's pixels) the corners keep it.
 */
export function dragCrop(rect, handle, dx, dy, { aspect = null, picW = 1, picH = 1, min = 0.04 } = {}) {
  let { x, y, w, h } = rect;
  if (handle === 'move') {
    x = Math.min(Math.max(0, x + dx), 1 - w);
    y = Math.min(Math.max(0, y + dy), 1 - h);
    return { x, y, w, h };
  }
  let x1 = x + w, y1 = y + h;
  if (handle.includes('w')) x = Math.min(Math.max(0, x + dx), x1 - min);
  if (handle.includes('e')) x1 = Math.max(Math.min(1, x1 + dx), x + min);
  if (handle.includes('n')) y = Math.min(Math.max(0, y + dy), y1 - min);
  if (handle.includes('s')) y1 = Math.max(Math.min(1, y1 + dy), y + min);
  w = x1 - x; h = y1 - y;
  if (aspect && handle.length === 2) {
    // The corner the person holds moves; the height follows the width at the chosen shape.
    const want = (w * picW) / aspect / picH;
    if (handle.includes('n')) { y = Math.max(0, y1 - want); h = y1 - y; } else { h = Math.min(want, 1 - y); }
    const fixW = (h * picH * aspect) / picW;
    if (handle.includes('w')) { x = x1 - fixW; } w = fixW;
  }
  return { x, y, w, h };
}

/** Output size for a resize: a width, a height or a percentage, keeping the shape. */
export function resizeTo(w, h, { width = null, height = null, percent = null } = {}) {
  if (percent) return [Math.max(1, Math.round((w * percent) / 100)), Math.max(1, Math.round((h * percent) / 100))];
  if (width) return [Math.max(1, Math.round(width)), Math.max(1, Math.round((h * width) / w))];
  if (height) return [Math.max(1, Math.round((w * height) / h)), Math.max(1, Math.round(height))];
  return [w, h];
}

/** Which format a picture is saved in: [mime, extension]. Browsers cannot write GIF, BMP or AVIF. */
export function outputFormat(choice, ext) {
  if (choice === 'jpeg') return ['image/jpeg', 'jpg'];
  if (choice === 'png') return ['image/png', 'png'];
  if (choice === 'webp') return ['image/webp', 'webp'];
  const e = String(ext || '').toLowerCase();
  if (/^(jpe?g|jfif|pjpeg)$/.test(e)) return ['image/jpeg', e === 'jpeg' ? 'jpeg' : 'jpg'];
  if (e === 'webp') return ['image/webp', 'webp'];
  if (e === 'avif') return ['image/jpeg', 'jpg'];
  return ['image/png', 'png'];   // png, gif, bmp
}
