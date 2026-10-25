// The photo report: where everything goes on the pages. Pure: it is given the words, the pictures' shapes and a way to
// measure text, and answers with a list of drawing operations per page, so the layout can be tested without a PDF library.
//
// Coordinates are in points, origin top-left, y down; the PDF builder (media/report.js) flips them. A page holds a title
// block (page 1), the record's fields in two columns, rows of photos, then a list of the other files. A photo row is as tall as its
// tallest picture (never more than a grid row of the page); a row that does not fit under what is already on the page goes
// to the next page, unless four fifths of it fit, in which case its pictures are drawn smaller there.

export const PAGE_SIZES = { a4: { w: 595.28, h: 841.89 }, letter: { w: 612, h: 792 } };
/** Photos per page: columns and rows of the grid. */
export const GRIDS = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3] };
export const PER_PAGE = [1, 2, 4, 6];

const MARGIN = 42, FOOT = 50, GAP = 14, COL_GAP = 24;
const TITLE = 22, SUB = 10, LABEL = 8.5, VALUE = 11, CAPTION = 9, OTHER = 10;
const lineH = (size, k = 1.25) => size * k;

/** A4 everywhere except where Letter is the paper (US, Canada). */
export const defaultPage = (culture) => (/^en[-_](US|CA)$/i.test(culture || '') ? 'letter' : 'a4');

/** Contain: the largest size with the picture's shape that fits the box. A picture with no known shape is taken as 4:3. */
export function fit(w, h, boxW, boxH) {
  const a = w > 0 && h > 0 ? w / h : 4 / 3;
  const dw = Math.min(boxW, boxH * a);
  return { w: dw, h: dw / a };
}

/** text cut with an ellipsis so it is at most maxW wide. */
export function ellipsize(text, maxW, measure, size, bold = false) {
  const s = String(text);
  if (measure(s, size, bold) <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(s.slice(0, mid).trimEnd() + '…', size, bold) <= maxW) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo).trimEnd() + '…';
}

/** Lines of at most maxW; breaks at spaces and newlines (a word longer than a line is cut). At most maxLines: the last one ends in an ellipsis. */
export function wrapText(text, maxW, measure, size, { bold = false, maxLines = Infinity } = {}) {
  const lines = [];
  for (const para of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (measure(w, size, bold) > maxW) {   // one word wider than the line
        let n = w.length;
        while (n > 1 && measure(w.slice(0, n), size, bold) > maxW) n--;
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = line ? line + ' ' + w : w;
      if (measure(next, size, bold) <= maxW) line = next; else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    keep[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(' ') || keep[maxLines - 1], maxW, measure, size, bold);
    return keep;
  }
  return lines;
}

/**
 * @param spec {page: 'a4'|'letter', perPage: 1|2|4|6, title, subtitle, fields: [{label, text}], photos: [{name, w, h}],
 *              others: [{name, info}], othersTitle, captions: boolean, footer(page, pages) -> string, footerTitle}
 * @param measure (text, size, bold) -> width in points
 * @returns {{size: {w, h}, pages: [{ops: object[]}], photoRows: number}}
 *   ops: {k:'text', x, y, text, size, bold, muted, align} (y is the top of the line box)
 *        {k:'rule', x1, x2, y}   {k:'photo', x, y, w, h, i}   (i indexes spec.photos)
 */
export function layoutReport(spec, measure) {
  const size = PAGE_SIZES[spec.page] || PAGE_SIZES.a4;
  const [cols, rows] = GRIDS[spec.perPage] || GRIDS[4];
  const left = MARGIN, width = size.w - 2 * MARGIN, top = MARGIN, bottom = size.h - FOOT;
  const rowH = Math.floor((bottom - top - (rows - 1) * GAP) / rows);
  const pages = [{ ops: [] }];
  let y = top;
  const page = () => pages[pages.length - 1];
  const newPage = () => { pages.push({ ops: [] }); y = top; };
  const room = () => bottom - y;
  const text = (x, yy, s, sz, o = {}) => page().ops.push({ k: 'text', x, y: yy, text: s, size: sz, bold: !!o.bold, muted: !!o.muted, align: o.align || 'left' });

  // ---- the title block ----
  const titleLines = wrapText(spec.title || '', width, measure, TITLE, { bold: true, maxLines: 2 });
  for (const l of titleLines) { text(left, y, l, TITLE, { bold: true }); y += lineH(TITLE, 1.2); }
  if (spec.subtitle) { y += 2; text(left, y, ellipsize(spec.subtitle, width, measure, SUB), SUB, { muted: true }); y += lineH(SUB); }
  y += 8;
  page().ops.push({ k: 'rule', x1: left, x2: left + width, y });
  y += 14;

  // ---- the record's fields, two columns ----
  const fields = (spec.fields || []).filter((f) => f && String(f.text ?? '').trim() !== '');
  const colW = (width - COL_GAP) / 2;
  for (let i = 0; i < fields.length; i += 2) {
    const pair = fields.slice(i, i + 2).map((f) => ({ f, lines: wrapText(f.text, colW, measure, VALUE, { maxLines: 3 }) }));
    const h = Math.max(...pair.map((c) => lineH(LABEL) + 1 + c.lines.length * lineH(VALUE, 1.3))) + 8;
    if (h > room() && y > top) newPage();
    pair.forEach((c, k) => {
      const x = left + k * (colW + COL_GAP);
      text(x, y, ellipsize(c.f.label, colW, measure, LABEL), LABEL, { muted: true });
      c.lines.forEach((l, n) => text(x, y + lineH(LABEL) + 1 + n * lineH(VALUE, 1.3), l, VALUE));
    });
    y += h;
  }
  if (fields.length) y += 6;

  // ---- photos, a row at a time ----
  const photos = spec.photos || [];
  const cellW = (width - (cols - 1) * GAP) / cols;
  const capH = spec.captions ? 16 : 0;
  let photoRows = 0;
  // Rows keep a fixed rhythm (one grid row of the page apart), so every page looks alike, and no page holds more rows than the
  // grid says. A row needs room for its pictures and captions only, not for the whole grid row: under the title block a
  // second row of landscape photos still fits. A row that does not fit is drawn smaller if four fifths of it fit; otherwise
  // it starts the next page.
  const rowOf = (r, boxH) => {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= photos.length) break;
      cells.push({ i, c, d: fit(photos[i].w, photos[i].h, cellW, boxH) });
    }
    return { cells, height: Math.max(...cells.map((x) => x.d.h)) + capH };
  };
  let onPage = 0, endY = y;
  for (let r = 0; r * cols < photos.length; r++) {
    if (onPage >= rows) { newPage(); onPage = 0; }
    let row = rowOf(r, rowH - capH);
    if (row.height > room()) {
      if (y > top && room() >= row.height * 0.8) row = rowOf(r, Math.floor(room()) - capH);
      else if (y > top) { newPage(); onPage = 0; row = rowOf(r, rowH - capH); }
    }
    for (const { i, c, d } of row.cells) {
      const x = left + c * (cellW + GAP);
      // Top of the cell, the caption right under the picture itself: a landscape and a portrait photo side by side start together.
      page().ops.push({ k: 'photo', x: x + (cellW - d.w) / 2, y, w: d.w, h: d.h, i });
      if (spec.captions && photos[i].name) text(x + cellW / 2, y + d.h + 4, ellipsize(photos[i].name, cellW, measure, CAPTION), CAPTION, { muted: true, align: 'center' });
    }
    endY = y + row.height + GAP;
    y += rowH + GAP;
    onPage++;
    photoRows++;
  }
  if (photos.length) y = endY;

  // ---- the other files ----
  const others = spec.others || [];
  if (others.length) {
    const head = lineH(12, 1.4) + 4;
    if (room() < head + 2 * lineH(OTHER, 1.5) && y > top) newPage();
    else y += 6;
    text(left, y, spec.othersTitle || '', 12, { bold: true });
    y += head;
    for (const o of others) {
      if (room() < lineH(OTHER, 1.5)) newPage();
      const info = o.info ? o.info : '';
      const infoW = info ? measure(info, OTHER, false) + 12 : 0;
      text(left, y, ellipsize(o.name, width - infoW, measure, OTHER), OTHER);
      if (info) text(left + width, y, info, OTHER, { muted: true, align: 'right' });
      y += lineH(OTHER, 1.5);
    }
  }

  // ---- the footer of every page, once the count is known ----
  const n = pages.length;
  pages.forEach((p, k) => {
    const ops = p.ops;
    const fy = size.h - FOOT + 22;
    const right = spec.footer ? spec.footer(k + 1, n) : '';
    const rw = right ? measure(right, CAPTION, false) + 16 : 0;
    if (spec.footerTitle) ops.push({ k: 'text', x: left, y: fy, text: ellipsize(spec.footerTitle, width - rw, measure, CAPTION), size: CAPTION, bold: false, muted: true, align: 'left' });
    if (right) ops.push({ k: 'text', x: left + width, y: fy, text: right, size: CAPTION, bold: false, muted: true, align: 'right' });
  });
  return { size, pages, photoRows };
}

/** The lines a person reads under the options: how many pages the report will have. */
export function pageEstimate(spec, measure) { return layoutReport(spec, measure).pages.length; }
