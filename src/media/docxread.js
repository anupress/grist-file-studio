// A Word document as blocks a viewer can draw: paragraphs (with headings, list markers and runs of bold, italic and
// underlined text), tables and pictures. Not Word's layout: no page breaks, headers, footers, footnotes or comments, and
// colours and fonts are left out so that what is shown is always readable. Changes that were tracked are shown as accepted.
//
// Takes the zip reader of media/unzip.js. Nothing here touches the DOM.

import { parseXml, rootOf, child, children, attr, descendants } from './xml.js';

const on = (el) => !!el && !['false', '0', 'off', 'none'].includes(String(el.attrs['w:val'] ?? 'true').toLowerCase());

// ---- styles and numbering ------------------------------------------------------------------------------

function readStyles(xml) {
  const styles = new Map();
  for (const st of descendants(rootOf(xml), 'w:style')) {
    const id = attr(st, 'w:styleId');
    if (!id) continue;
    const outline = attr(child(child(st, 'w:pPr'), 'w:outlineLvl'), 'w:val');
    styles.set(id, { name: attr(child(st, 'w:name'), 'w:val') || '', based: attr(child(st, 'w:basedOn'), 'w:val') || null, outline: outline != null ? Number(outline) : null });
  }
  return styles;
}

/** null for body text, 0 for a title, 1 to 6 for headings. */
export function headingLevel(styles, id) {
  for (let hop = 0; id && hop < 12; hop++) {
    const s = styles.get(id);
    const name = s ? s.name : id;
    const m = /^heading\s*(\d)$/i.exec(name);
    if (m) return Math.min(6, Math.max(1, Number(m[1])));
    if (/^title$/i.test(name)) return 0;
    if (s && s.outline != null && s.outline < 9) return Math.min(6, s.outline + 1);
    id = s ? s.based : null;
  }
  return null;
}

function readNumbering(xml) {
  const root = rootOf(xml);
  const abstracts = new Map(), nums = new Map();
  for (const a of children(root, 'w:abstractNum')) {
    const levels = [];
    for (const l of children(a, 'w:lvl')) {
      levels[Number(attr(l, 'w:ilvl')) || 0] = { fmt: attr(child(l, 'w:numFmt'), 'w:val') || 'decimal', text: attr(child(l, 'w:lvlText'), 'w:val') ?? '', start: Number(attr(child(l, 'w:start'), 'w:val') ?? 1) };
    }
    abstracts.set(attr(a, 'w:abstractNumId'), levels);
  }
  for (const n of children(root, 'w:num')) nums.set(attr(n, 'w:numId'), attr(child(n, 'w:abstractNumId'), 'w:val'));
  return { abstracts, nums };
}

const letters = (n, upper) => { let s = ''; for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s; return upper ? s.toUpperCase() : s; };
const roman = (n, upper) => {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return upper ? s.toUpperCase() : s;
};
export function formatCounter(n, fmt) {
  switch (fmt) {
    case 'lowerLetter': return letters(n, false);
    case 'upperLetter': return letters(n, true);
    case 'lowerRoman': return roman(n, false);
    case 'upperRoman': return roman(n, true);
    case 'decimalZero': return String(n).padStart(2, '0');
    case 'none': return '';
    default: return String(n);
  }
}
const BULLETS = ['•', '◦', '▪'];

// ---- reading ---------------------------------------------------------------------------------------------

/**
 * @param zip the reader of media/unzip.js
 * @param o {maxBlocks}
 * @returns {Promise<{blocks: object[], truncated: boolean}>}
 *   block: {k: 'p', heading: null|0..6, align, marker: string|null, level, runs}  |  {k: 'table', rows: [{cells: [{blocks, span, rowSpan}]}]}
 *   run:   {t, b, i, u, s, sup, sub, href} | {br: true} | {img: {path, w, h}}  (w and h in CSS pixels, 0 when unknown)
 */
export async function readDocx(zip, { maxBlocks = 4000 } = {}) {
  const doc = parseXml(await zip.text('word/document.xml', 30e6));
  const body = child(rootOf(doc), 'w:body');
  const styles = zip.has('word/styles.xml') ? readStyles(parseXml(await zip.text('word/styles.xml', 6e6))) : new Map();
  const numbering = zip.has('word/numbering.xml') ? readNumbering(parseXml(await zip.text('word/numbering.xml', 3e6))) : { abstracts: new Map(), nums: new Map() };
  const rels = new Map();
  if (zip.has('word/_rels/document.xml.rels')) {
    for (const r of descendants(rootOf(parseXml(await zip.text('word/_rels/document.xml.rels', 1e6))), 'Relationship')) {
      rels.set(r.attrs.Id, { target: r.attrs.Target || '', external: /external/i.test(r.attrs.TargetMode || '') });
    }
  }
  const counters = new Map();   // numId -> counters per level
  const ctx = { styles, numbering, rels, counters, budget: maxBlocks, truncated: false };
  const blocks = readBlocks(body, ctx);
  return { blocks, truncated: ctx.truncated };
}

function readBlocks(container, ctx) {
  const out = [];
  if (!container) return out;
  for (const k of container.kids) {
    if (ctx.budget <= 0) { ctx.truncated = true; break; }
    if (k.name === 'w:p') { out.push(readParagraph(k, ctx)); ctx.budget--; }
    else if (k.name === 'w:tbl') { out.push(readTable(k, ctx)); ctx.budget--; }
    else if (k.name === 'w:sdt') out.push(...readBlocks(child(k, 'w:sdtContent'), ctx));
    else if (k.name === 'w:customXml') out.push(...readBlocks(k, ctx));
    else if (k.name === 'mc:AlternateContent') out.push(...readBlocks(child(k, 'mc:Choice'), ctx));
  }
  return out;
}

function readParagraph(p, ctx) {
  const ppr = child(p, 'w:pPr');
  const styleId = attr(child(ppr, 'w:pStyle'), 'w:val');
  const numPr = child(ppr, 'w:numPr');
  const numId = attr(child(numPr, 'w:numId'), 'w:val');
  const level = Number(attr(child(numPr, 'w:ilvl'), 'w:val')) || 0;
  const jc = attr(child(ppr, 'w:jc'), 'w:val');
  let marker = null;
  if (numId && numId !== '0') marker = markerFor(ctx, numId, level);
  return {
    k: 'p', heading: headingLevel(ctx.styles, styleId), align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' ? 'justify' : 'left',
    marker, level: marker == null ? 0 : level, runs: mergeRuns(readRuns(p, {}, ctx)),
  };
}

function markerFor(ctx, numId, ilvl) {
  const { abstracts, nums } = ctx.numbering;
  const levels = abstracts.get(nums.get(numId)) || [];
  const lv = levels[ilvl] || { fmt: 'bullet', text: '•', start: 1 };
  if (lv.fmt === 'bullet') return BULLETS[Math.min(ilvl, 2)];
  const have = ctx.counters.get(numId) || [];
  have.length = ilvl + 1;   // deeper levels start again
  have[ilvl] = (have[ilvl] ?? (lv.start - 1)) + 1;
  for (let k = 0; k < ilvl; k++) if (have[k] == null) have[k] = (levels[k]?.start ?? 1);
  ctx.counters.set(numId, have);
  const text = lv.text || `%${ilvl + 1}.`;
  return text.replace(/%(\d)/g, (m, d) => formatCounter(have[Number(d) - 1] ?? 1, levels[Number(d) - 1]?.fmt || 'decimal'));
}

function runProps(r, inherit) {
  const rpr = child(r, 'w:rPr');
  if (!rpr) return { ...inherit };
  const va = attr(child(rpr, 'w:vertAlign'), 'w:val');
  const u = child(rpr, 'w:u');
  return {
    ...inherit,
    b: child(rpr, 'w:b') ? on(child(rpr, 'w:b')) : inherit.b, i: child(rpr, 'w:i') ? on(child(rpr, 'w:i')) : inherit.i,
    u: u ? attr(u, 'w:val') !== 'none' : inherit.u, s: child(rpr, 'w:strike') ? on(child(rpr, 'w:strike')) : inherit.s,
    sup: va === 'superscript', sub: va === 'subscript',
  };
}

function readRuns(container, inherit, ctx) {
  const out = [];
  for (const k of container.kids) {
    if (k.name === 'w:r') {
      const props = runProps(k, inherit);
      for (const c of k.kids) {
        if (c.name === 'w:t') out.push({ t: c.text, ...props });
        else if (c.name === 'w:tab') out.push({ t: '\t', ...props });
        else if (c.name === 'w:br' || c.name === 'w:cr') out.push({ br: true });
        else if (c.name === 'w:noBreakHyphen') out.push({ t: '-', ...props });
        else if (c.name === 'w:drawing' || c.name === 'w:pict' || c.name === 'mc:AlternateContent') {
          const img = findImage(c, ctx);
          if (img) out.push({ img });
        }
      }
    } else if (k.name === 'w:hyperlink') {
      const rel = ctx.rels.get(attr(k, 'r:id'));
      const href = rel && rel.external && /^(https?:|mailto:)/i.test(rel.target) ? rel.target : null;
      for (const r of readRuns(k, inherit, ctx)) out.push(href && r.t != null ? { ...r, href } : r);
    } else if (k.name === 'w:ins' || k.name === 'w:moveTo' || k.name === 'w:smartTag' || k.name === 'w:fldSimple' || k.name === 'w:customXml') out.push(...readRuns(k, inherit, ctx));
    else if (k.name === 'w:sdt') out.push(...readRuns(child(k, 'w:sdtContent') || { kids: [] }, inherit, ctx));
    // w:del and w:moveFrom (deleted text) are left out on purpose
  }
  return out;
}

function findImage(node, ctx) {
  // a modern picture, or the fallback of an old one
  const scope = node.name === 'mc:AlternateContent' ? (child(node, 'mc:Choice') || node) : node;
  const blip = descendants(scope, 'a:blip')[0];
  const id = blip ? attr(blip, 'r:embed') : attr(descendants(scope, 'v:imagedata')[0], 'r:id');
  const rel = id && ctx.rels.get(id);
  if (!rel || rel.external) return null;
  const ext = descendants(scope, 'wp:extent')[0];
  const path = rel.target.startsWith('/') ? rel.target.slice(1) : 'word/' + rel.target.replace(/^\.\//, '');
  return { path, w: ext ? Math.round(Number(attr(ext, 'cx')) / 9525) || 0 : 0, h: ext ? Math.round(Number(attr(ext, 'cy')) / 9525) || 0 : 0 };
}

/** Neighbouring text runs with the same look become one. */
function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r.t != null && last.t != null && last.b === r.b && last.i === r.i && last.u === r.u && last.s === r.s && last.sup === r.sup && last.sub === r.sub && last.href === r.href) last.t += r.t;
    else out.push({ ...r });
  }
  return out;
}

function readTable(tbl, ctx) {
  const rows = [];
  const open = [];   // grid column -> the cell above whose vertical merge goes on there
  for (const tr of children(tbl, 'w:tr')) {
    const cells = [];
    let col = 0;
    for (const tc of children(tr, 'w:tc')) {
      const pr = child(tc, 'w:tcPr');
      const span = Number(attr(child(pr, 'w:gridSpan'), 'w:val')) || 1;
      const vm = child(pr, 'w:vMerge');
      if (vm && attr(vm, 'w:val') !== 'restart' && open[col]) { open[col].rowSpan++; col += span; continue; }
      const cell = { blocks: readBlocks(tc, ctx), span, rowSpan: 1 };
      cells.push(cell);
      for (let k = 0; k < span; k++) open[col + k] = vm ? cell : null;
      col += span;
    }
    rows.push({ cells });
  }
  return { k: 'table', rows };
}
