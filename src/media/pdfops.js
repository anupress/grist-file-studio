// The PDF tools' work, apart from any screen: which pages go where, what is drawn on them, and the
// file that comes out. Everything takes the pdf-lib namespace as `lib`, so the browser passes the
// vendored bundle and the tests pass the same file from Node.
//
// Two coordinate systems meet here, and every bug in a PDF editor lives in the join between them:
//   * the DISPLAY frame: the page as a person sees it, after its /Rotate. Origin top-left, y down. Marks
//     are stored as fractions (0..1) of the displayed width and height, with sizes in points.
//   * the USER space of the file: the page before /Rotate, origin bottom-left, y up, in points.
// A mark carries its own `angle` (clockwise degrees, in the display frame). Turning a page therefore
// turns its marks with it: turnElement() moves the anchor and adds to the angle, nothing else changes.

export const MAX_IMAGE_SIDE = 842;   // a photo becomes a page whose long side is at most A4's, in points
export const LINE_HEIGHT = 1.25;     // the line box of marked text, in em (the editor draws with the same)

export const FONT_FACES = {
  sans: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  serif: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  mono: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};
// From the top of a 1.25 line box to the baseline, in em, for the browser's Arial / Times New Roman /
// Courier New (the metric twins of the three standard fonts), so a mark lands where it was placed.
export const BASELINE = { sans: 0.97, serif: 0.96, mono: 0.89 };

/** An angle folded into 0 <= a < 360. */
export const norm = (a) => ((a % 360) + 360) % 360;

// ---- turning a page ---------------------------------------------------------------------------------

/** A point of the unit square after the page is turned `deg` clockwise (a multiple of 90). */
export function turnPoint(p, deg) {
  const d = norm(deg);
  if (d === 90) return { x: 1 - p.y, y: p.x };
  if (d === 180) return { x: 1 - p.x, y: 1 - p.y };
  if (d === 270) return { x: p.y, y: 1 - p.x };
  return { x: p.x, y: p.y };
}

/** A mark after its page is turned `deg` clockwise: it stays on the same spot of the paper. */
export function turnElement(el, deg) {
  const d = norm(deg);
  if (!d) return el;
  if (el.type === 'draw') return { ...el, points: el.points.map(([x, y]) => { const q = turnPoint({ x, y }, d); return [q.x, q.y]; }) };
  const q = turnPoint({ x: el.x, y: el.y }, d);
  return { ...el, x: q.x, y: q.y, angle: norm((el.angle || 0) + d) };
}

/** The size of a page as displayed, in points, from its crop box and its rotation. */
export function displaySize(crop, rotation) {
  return norm(rotation) % 180 ? { w: crop.height, h: crop.width } : { w: crop.width, h: crop.height };
}

/** A point of the display frame (unit square) -> the page's user space, in points. */
export function userPoint(p, rotation, crop) {
  const W = crop.width, H = crop.height;
  switch (norm(rotation)) {
    case 90: return { x: crop.x + p.y * W, y: crop.y + p.x * H };
    case 180: return { x: crop.x + (1 - p.x) * W, y: crop.y + p.y * H };
    case 270: return { x: crop.x + (1 - p.y) * W, y: crop.y + (1 - p.x) * H };
    default: return { x: crop.x + p.x * W, y: crop.y + (1 - p.y) * H };
  }
}

/** A point of a mark's own frame (points from its anchor, y down) -> the display frame (unit square). */
export function localPoint(el, lx, ly, Wd, Hd) {
  const a = ((el.angle || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: el.x + (lx * c - ly * s) / Wd, y: el.y + (lx * s + ly * c) / Hd };
}

/** The box a box-like mark (cover, highlight, tick, cross, picture) covers in the display frame, in unit fractions. */
export function elementBox(el, Wd, Hd) {
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => localPoint(el, (sx * el.w) / 2, (sy * el.h) / 2, Wd, Hd));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ---- which pages ------------------------------------------------------------------------------------

/**
 * "1-3, 5, 8-" -> groups of page indices (0-based), in the order written. Open ends run to the last page.
 * Returns {groups} or {error: 'empty' | 'syntax' | 'range'}.
 */
export function parseRanges(text, n) {
  const parts = String(text || '').split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return { error: 'empty' };
  const groups = [];
  for (const part of parts) {
    const m = /^(\d*)\s*(?:[-–—]\s*(\d*))?$/.exec(part);
    if (!m || (!m[1] && !m[2])) return { error: 'syntax' };
    const dash = /[-–—]/.test(part);
    const a = m[1] ? Number(m[1]) : 1;
    const b = dash ? (m[2] ? Number(m[2]) : n) : a;
    if (a < 1 || b > n || a > b) return { error: 'range' };
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  return { groups };
}

/** How a document is cut up: 'each' page alone, 'every' k pages, or 'ranges' written out. -> {groups} | {error} */
export function splitGroups(mode, n, value) {
  if (mode === 'ranges') return parseRanges(value, n);
  if (mode === 'every') {
    const k = Math.floor(Number(value));
    if (!(k >= 1)) return { error: 'syntax' };
    const groups = [];
    for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j));
    return { groups };
  }
  return { groups: Array.from({ length: n }, (_, i) => [i]) };
}

// ---- text and colour --------------------------------------------------------------------------------

export function hexToRgb(lib, color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || '#111827');
  const n = parseInt(m ? m[1] : '111827', 16);
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** The characters of `text` a standard PDF font cannot draw (it covers Western European text). */
export function unsupportedChars(charset, text) {
  const bad = new Set();
  for (const ch of String(text || '')) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    if (!charset.has(ch.codePointAt(0))) bad.add(ch);
  }
  return [...bad];
}

const cleanText = (charset, s) => [...String(s || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')].map((ch) => (ch === '\n' || charset.has(ch.codePointAt(0)) ? ch : '?')).join('');

/** Embeds the standard fonts a document's marks use, once each. */
function fontBook(lib, doc) {
  const cache = new Map();
  return async (family, bold, italic) => {
    const fam = FONT_FACES[family] ? family : 'sans';
    const key = `${fam}:${bold ? 1 : 0}${italic ? 1 : 0}`;
    if (!cache.has(key)) {
      const font = await doc.embedFont(lib.StandardFonts[FONT_FACES[fam][(bold ? 1 : 0) + (italic ? 2 : 0)]]);
      cache.set(key, { font, charset: new Set(font.getCharacterSet()) });
    }
    return cache.get(key);
  };
}

// ---- page numbers and watermark, as marks -----------------------------------------------------------

const POSITIONS = {
  tl: ['left', 'top', 0, 0], tc: ['center', 'top', 0.5, 0], tr: ['right', 'top', 1, 0],
  bl: ['left', 'bottom', 0, 1], bc: ['center', 'bottom', 0.5, 1], br: ['right', 'bottom', 1, 1],
};
export const NUMBER_POSITIONS = Object.keys(POSITIONS);

/** The text of one page number. `i` counts the kept pages from 0; returns null where no number goes. */
export function numberLabel(spec, i, n) {
  const skip = spec.skipFirst ? 1 : 0;
  if (i < skip) return null;
  const num = (spec.start || 1) + i - skip;
  const total = (spec.start || 1) + n - skip - 1;
  const word = spec.word || 'Page';
  switch (spec.format) {
    case 'n-of-m': return `${num} / ${total}`;
    case 'page-n': return `${word} ${num}`;
    case 'page-n-of-m': return `${word} ${num} / ${total}`;
    default: return String(num);
  }
}

/** The marks that numbering and a watermark put on page `i` of `n` (display size Wd × Hd points). */
export function stampElements(spec, i, n, Wd, Hd) {
  const out = [];
  const nm = spec?.numbers;
  if (nm?.on) {
    const text = numberLabel(nm, i, n);
    if (text) {
      const [align, valign, fx, fy] = POSITIONS[nm.position] || POSITIONS.bc;
      const margin = nm.margin ?? 28;
      out.push({ id: 'stamp-number', type: 'text', text, size: nm.size || 10, font: 'sans', color: nm.color || '#374151', align, valign,
        x: fx === 0 ? margin / Wd : fx === 1 ? 1 - margin / Wd : 0.5, y: fy === 0 ? margin / Hd : 1 - margin / Hd, angle: 0 });
    }
  }
  const wm = spec?.watermark;
  if (wm?.on && String(wm.text || '').trim()) {
    out.push({ id: 'stamp-watermark', type: 'text', text: String(wm.text).trim(), size: wm.size || 72, font: 'sans', bold: true, color: wm.color || '#9ca3af',
      opacity: wm.opacity ?? 0.25, align: 'center', valign: 'middle', x: 0.5, y: 0.5, angle: wm.diagonal === false ? 0 : 315 });
  }
  return out;
}

// ---- drawing marks onto a page ----------------------------------------------------------------------

const dataUrlBytes = (dataUrl) => {
  const bin = atob(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** The smoothed stroke of a pen mark as an SVG path through the given points (already in page units). */
export function smoothPathD(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last[0]} ${last[1]}`;
}

/** The CHECK and CROSS strokes on a 21-unit box: [[x1, y1, x2, y2], ...]. The editor draws the same. */
export const TICK_STROKES = { check: [[3, 11, 8.2, 16.6], [8.2, 16.6, 18.6, 4.4]], cross: [[4, 4, 17, 17], [17, 4, 4, 17]] };

/**
 * Draws `elements` (display-frame marks) onto a pdf-lib page. `book` is the document's fontBook and
 * `images` a Map that embeds each distinct picture once. Returns the characters it could not draw.
 */
export async function drawElements(lib, doc, page, elements, book, images) {
  const R = norm(page.getRotation().angle);
  const crop = page.getCropBox();
  const { w: Wd, h: Hd } = displaySize(crop, R);
  const U = (p) => userPoint(p, R, crop);
  const rot = (angle) => lib.degrees(norm(R - (angle || 0)));
  const dropped = new Set();

  for (const el of elements) {
    if (el.type === 'text') {
      const { font, charset } = await book(el.font, el.bold, el.italic);
      for (const ch of unsupportedChars(charset, el.text)) dropped.add(ch);
      const lines = cleanText(charset, el.text).split('\n');
      const size = el.size || 12, lh = size * LINE_HEIGHT;
      const widths = lines.map((l) => font.widthOfTextAtSize(l, size));
      const tw = Math.max(...widths, 0), th = lines.length * lh;
      const ax = el.align === 'center' ? 0.5 : el.align === 'right' ? 1 : 0;
      const ay = el.valign === 'middle' ? 0.5 : el.valign === 'bottom' ? 1 : 0;
      const color = hexToRgb(lib, el.color);
      lines.forEach((line, k) => {
        if (!line.trim()) return;
        const lx = -ax * tw + (tw - widths[k]) * ax;
        const ly = -ay * th + k * lh + (BASELINE[el.font] ?? BASELINE.sans) * size;
        const p = U(localPoint(el, lx, ly, Wd, Hd));
        page.drawText(line, { x: p.x, y: p.y, size, font, color, rotate: rot(el.angle), opacity: el.opacity ?? 1 });
      });
    } else if (el.type === 'rect' || el.type === 'hilite') {
      const b = elementBox(el, Wd, Hd);
      const a = U({ x: b.x, y: b.y }), c = U({ x: b.x + b.w, y: b.y + b.h });
      page.drawRectangle({
        x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y),
        color: hexToRgb(lib, el.color || (el.type === 'hilite' ? '#ffd60a' : '#ffffff')), opacity: el.type === 'hilite' ? 0.38 : 1,
      });
    } else if (el.type === 'check' || el.type === 'cross') {
      const sx = el.w / 21, sy = el.h / 21;
      const thickness = Math.max(1, 2.6 * Math.min(sx, sy) * ((el.weight || 2) / 2));
      for (const [x1, y1, x2, y2] of TICK_STROKES[el.type]) {
        const a = U(localPoint(el, (x1 - 10.5) * sx, (y1 - 10.5) * sy, Wd, Hd)), c = U(localPoint(el, (x2 - 10.5) * sx, (y2 - 10.5) * sy, Wd, Hd));
        page.drawLine({ start: a, end: c, thickness, color: hexToRgb(lib, el.color), lineCap: lib.LineCapStyle.Round });
      }
    } else if (el.type === 'image') {
      let image = images.get(el.dataUrl);
      if (!image) {
        const raw = dataUrlBytes(el.dataUrl);
        image = String(el.dataUrl).startsWith('data:image/jpeg') ? await doc.embedJpg(raw) : await doc.embedPng(raw);
        images.set(el.dataUrl, image);
      }
      const p = U(localPoint(el, -el.w / 2, el.h / 2, Wd, Hd));   // the picture's bottom-left corner
      page.drawImage(image, { x: p.x, y: p.y, width: el.w, height: el.h, rotate: rot(el.angle) });
    } else if (el.type === 'draw' && el.points?.length > 1) {
      const pts = el.points.map(([x, y]) => { const p = U({ x, y }); return [p.x, -p.y]; });   // drawSvgPath flips y
      page.pushOperators(lib.pushGraphicsState(), lib.setLineJoin(lib.LineJoinStyle.Round));
      page.drawSvgPath(smoothPathD(pts), { x: 0, y: 0, borderColor: hexToRgb(lib, el.color), borderWidth: Math.max(0.4, el.width || 2),
        borderOpacity: el.opacity ?? 1, borderLineCap: lib.LineCapStyle.Round });
      page.pushOperators(lib.popGraphicsState());
    }
  }
  return [...dropped];
}

// ---- building the file ------------------------------------------------------------------------------

/** Opens PDF bytes for editing. A password may be given; without one an encrypted file throws EncryptedPDFError. */
export function openDocument(lib, bytes, password) {
  return lib.PDFDocument.load(bytes, { password: password || undefined, updateMetadata: false });
}

/** A one-page PDF around a JPEG or PNG: the page is the picture's shape, at most A4's long side. */
export async function imageToPdf(lib, imageBytes, type, width, height) {
  const doc = await lib.PDFDocument.create();
  const image = type === 'png' ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  const w = Math.max(1, width * k), h = Math.max(1, height * k);
  doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  return doc.save({ useObjectStreams: true });
}

/**
 * The document that results from a plan.
 *   load(srcId)      -> a FRESH pdf-lib document of that source each call
 *   pages            -> [{id, src, page, rotate}] the kept pages in their new order: `page` is the 0-based
 *                       index in the source, `rotate` clockwise degrees to add
 *   marks            -> Map(page id -> display-frame marks) drawn on that page, in its final rotation
 *   stamp            -> page numbers and watermark for every page (see stampElements)
 * Returns {bytes, dropped: characters the standard fonts could not draw}.
 *
 * Two ways to the same result, chosen by what the plan does:
 *   * every page of ONE source is kept (turning, reordering, copying, marks, numbers): the document is edited
 *     where it stands, so bookmarks, form fields and the file's information survive;
 *   * pages are left out, or several files are joined: a NEW document is built from copied pages. pdf-lib
 *     never prunes a file it saves, so a page "removed" from the old document would still be inside it,
 *     with its text, and a page sent to someone else must carry nothing of the others.
 */
export async function buildPdf(lib, { load, pages, marks = new Map(), stamp = null, title = null }) {
  if (!pages.length) throw new Error('No pages');
  const docs = new Map();
  const get = async (id) => { if (!docs.has(id)) docs.set(id, await load(id)); return docs.get(id); };
  const baseId = pages[0].src;
  const single = pages.every((e) => e.src === baseId);
  const base = await get(baseId);
  const inPlace = single && new Set(pages.map((e) => e.page)).size === base.getPageCount();

  let out;
  const objs = [];
  const used = new Set();
  if (inPlace) {
    out = base;
    const original = out.getPages();
    for (const e of pages) {
      if (!used.has(e.page)) { used.add(e.page); objs.push(original[e.page]); }
      else objs.push((await out.copyPages(out, [e.page]))[0]);   // the same page twice needs a page of its own
    }
    // Out of the page tree and back in the new order. The page objects stay in the file (doc.removePage would
    // delete them), which is fine here: every one of them is kept.
    for (let k = out.getPageCount() - 1; k >= 0; k--) out.catalog.removeLeafNode(k);
    out.pageCount = 0;
    out.pageCache.invalidate();
    objs.forEach((p, k) => out.insertPage(k, p));
  } else {
    out = await lib.PDFDocument.create();
    const wanted = new Map();
    for (const e of pages) {
      if (!wanted.has(e.src)) wanted.set(e.src, []);
      if (!wanted.get(e.src).includes(e.page)) wanted.get(e.src).push(e.page);
    }
    const copied = new Map();
    for (const [id, idx] of wanted) {
      const cp = await out.copyPages(await get(id), idx);   // once per source, so shared fonts and images are copied once
      idx.forEach((p, k) => copied.set(`${id}:${p}`, cp[k]));
    }
    for (const e of pages) {
      const key = `${e.src}:${e.page}`;
      if (!used.has(key)) { used.add(key); objs.push(copied.get(key)); }
      else objs.push((await out.copyPages(await get(e.src), [e.page]))[0]);
    }
    objs.forEach((p) => out.addPage(p));
    if (single) {
      for (const [get1, set1] of [['getTitle', 'setTitle'], ['getAuthor', 'setAuthor'], ['getSubject', 'setSubject']]) {
        const v = base[get1]();
        if (v) out[set1](v);
      }
    }
  }

  const book = fontBook(lib, out);
  const images = new Map();
  const dropped = new Set();
  for (let k = 0; k < pages.length; k++) {
    const page = out.getPage(k);
    if (pages[k].rotate) page.setRotation(lib.degrees(norm(page.getRotation().angle + pages[k].rotate)));
    const { w, h } = displaySize(page.getCropBox(), page.getRotation().angle);
    const list = [...(marks.get(pages[k].id) || []), ...(stamp ? stampElements(stamp, k, pages.length, w, h) : [])];
    if (list.length) for (const ch of await drawElements(lib, out, page, list, book, images)) dropped.add(ch);
  }
  if (title) out.setTitle(title);
  out.setProducer('ANUPRESS File Studio');
  out.setModificationDate(new Date());
  return { bytes: await out.save({ useObjectStreams: true }), dropped: [...dropped] };
}

/** True when the file carries a digital signature, which any change breaks. */
export function hasSignature(bytes) {
  const needle = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65];   // /ByteRange
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    if (bytes[i] !== 0x2f) continue;
    for (let j = 1; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
