// An Excel workbook as tables a viewer can draw: each sheet's cells as the text Excel would show (numbers in their format,
// dates as dates, percentages, booleans, the cached result of formulas), column widths and merged cells. Not Excel: no charts,
// pictures, conditional formats or cell colours, and long sheets are cut (1,000 rows, 60 columns) with a note.
//
// Takes the zip reader of media/unzip.js. Nothing here touches the DOM.

import { parseXml, rootOf, child, children, attr, descendants } from './xml.js';

// ---- cell references -----------------------------------------------------------------------------------

/** "C12" -> {col: 2, row: 11} (0-based). */
export function refOf(ref) {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}
/** 0 -> "A", 26 -> "AA". */
export function colName(i) { let s = ''; for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; }

// ---- number formats ----------------------------------------------------------------------------------------

const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00' };
const plain = (code) => code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '').replace(/\*./g, '');

/** Does this number format show a date or a time? (id: the style's numFmtId, code: its format code when it has one) */
export function isDateFormat(id, code) {
  if (!code) return DATE_IDS.has(id);
  const first = plain(code).split(';')[0];
  return /[ymdhs]/i.test(first) && !/^\s*general\s*$/i.test(first);
}

/** A date serial of the workbook -> a JS Date at the same wall-clock time in UTC. */
export function serialToDate(serial, date1904 = false) {
  if (date1904) return new Date(Date.UTC(1904, 0, 1) + Math.round(serial * 864e5));
  // Excel's 1900 system counts a 29 February 1900 that never was: before March the epoch is a day later.
  return new Date((serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)) + Math.round(serial * 864e5));
}

const fmtCache = new Map();
const nf = (locale, o) => { const k = locale + JSON.stringify(o); if (!fmtCache.has(k)) fmtCache.set(k, new Intl.NumberFormat(locale, o)); return fmtCache.get(k); };
const df = (locale, o) => { const k = 'd' + locale + JSON.stringify(o); if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat(locale, o)); return fmtCache.get(k); };

/** The text a number shows in a format. Decimals, thousands separators, percent, scientific and a currency sign are understood; the rest is "General". */
export function formatNumber(n, code, locale = 'en') {
  if (!Number.isFinite(n)) return String(n);
  const c = (code || 'General').split(';')[0];
  const p = plain(c);
  const general = () => nf(locale, { useGrouping: false, maximumFractionDigits: 10 }).format(Number(n.toPrecision(12)));
  if (/^\s*general\s*$/i.test(c) || !/[0#?]/.test(p)) return general();
  if (/\?\/|#\s*\?+\/|\/\d/.test(p) && !/%/.test(p)) return general();   // fractions: shown as decimals
  const dec = (/\.([0#?]+)/.exec(p) || [, ''])[1].length;
  const fixed = (/\.([0#?]+)/.exec(p) || [, ''])[1];
  const minDec = (fixed.match(/0/g) || []).length;
  const grouping = /[0#],[0#]/.test(p);
  if (/E[+-]0/i.test(p)) return n.toExponential(dec).replace('e', 'E');
  if (/%/.test(p)) return nf(locale, { style: 'percent', minimumFractionDigits: minDec, maximumFractionDigits: dec }).format(n);
  let out = nf(locale, { useGrouping: grouping, minimumFractionDigits: minDec, maximumFractionDigits: dec }).format(n);
  // a currency sign written in the format ("€", [$€-407], $) goes where the format puts it
  const lit = /"([^"]+)"/.exec(c) || /\[\$([^\]\-]*)[^\]]*\]/.exec(c) || /([$€£¥])/.exec(c);
  if (lit && lit[1].trim()) {
    const sign = lit[1].trim();
    const firstDigit = c.search(/[0#?]/), at = c.indexOf(lit[0]);
    let lastDigit = -1;
    for (let k = c.length - 1; k >= 0; k--) if (/[0#?]/.test(c[k])) { lastDigit = k; break; }
    // as the format spaces it: "€" #,##0.00 has a space, [$€-407]#,##0.00 has none
    if (at < firstDigit) out = sign + (/\s/.test(c.slice(at + lit[0].length, firstDigit)) || /^[A-Za-z]{2,}$/.test(sign) ? ' ' : '') + out;
    else out = out + (/\s/.test(c.slice(lastDigit + 1, at)) ? ' ' : '') + sign;
  }
  return out;
}

/** A date serial shown in a format: date, time or both, in the locale's own way. */
export function formatDate(serial, code, locale = 'en', date1904 = false) {
  const d = serialToDate(serial, date1904);
  const p = code ? plain(code).split(';')[0] : 'm/d/yy';
  const time = /[hs]/i.test(p);
  const date = /[yd]/i.test(p) || (/m/i.test(p) && !time);
  try {
    if (date && time) return df(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(d);
    if (time) return df(locale, { timeStyle: 'short', timeZone: 'UTC' }).format(d);
    return df(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
  } catch { return d.toISOString().slice(0, 10); }
}

// ---- reading ---------------------------------------------------------------------------------------------

function readSharedStrings(xml) {
  return children(rootOf(xml), 'si').map((si) => {
    const direct = child(si, 't');
    if (direct) return direct.text;
    return children(si, 'r').map((r) => (child(r, 't') ? child(r, 't').text : '')).join('');
  });
}

function readStyles(xml) {
  const root = rootOf(xml);
  const codes = new Map();
  for (const f of descendants(child(root, 'numFmts') || { kids: [] }, 'numFmt')) codes.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode'));
  const xfs = children(child(root, 'cellXfs'), 'xf').map((xf) => {
    const id = Number(attr(xf, 'numFmtId')) || 0;
    return { id, code: codes.get(id) || BUILTIN[id] || null };
  });
  return xfs;
}

/**
 * @param zip the reader of media/unzip.js
 * @param o {locale, maxRows, maxCols}
 * @returns {Promise<{sheets: {name, rows: ({text, kind: 'text'|'number'|'bool'|'error'}|undefined)[][], widths: number[], merges: {r0, c0, r1, c1}[], truncated: boolean, cols: number}[]}>}
 */
export async function readXlsx(zip, { locale = 'en', maxRows = 1000, maxCols = 60 } = {}) {
  const wb = rootOf(parseXml(await zip.text('xl/workbook.xml', 4e6)));
  const date1904 = ['1', 'true'].includes(String(attr(descendants(wb, 'workbookPr')[0], 'date1904') || '').toLowerCase());
  const rels = new Map();
  if (zip.has('xl/_rels/workbook.xml.rels')) {
    for (const r of descendants(rootOf(parseXml(await zip.text('xl/_rels/workbook.xml.rels', 1e6))), 'Relationship')) rels.set(r.attrs.Id, r.attrs.Target || '');
  }
  const shared = zip.has('xl/sharedStrings.xml') ? readSharedStrings(parseXml(await zip.text('xl/sharedStrings.xml', 25e6))) : [];
  const xfs = zip.has('xl/styles.xml') ? readStyles(parseXml(await zip.text('xl/styles.xml', 4e6))) : [];

  const sheets = [];
  for (const s of descendants(wb, 'sheet')) {
    if (['hidden', 'veryHidden'].includes(attr(s, 'state'))) continue;
    const target = rels.get(attr(s, 'r:id')) || '';
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    if (!zip.has(path)) continue;
    sheets.push(readSheet(rootOf(parseXml(await zip.text(path, 25e6))), attr(s, 'name') || `Sheet ${sheets.length + 1}`, { shared, xfs, date1904, locale, maxRows, maxCols }));
  }
  return { sheets };
}

function readSheet(root, name, o) {
  const rows = [];
  let truncated = false, width = 0;
  for (const row of children(child(root, 'sheetData'), 'row')) {
    const r = attr(row, 'r') ? Number(attr(row, 'r')) - 1 : rows.length;
    if (r >= o.maxRows) { truncated = true; break; }
    if (['1', 'true'].includes(attr(row, 'hidden'))) continue;
    const line = rows[r] || (rows[r] = []);
    let next = 0;
    for (const c of children(row, 'c')) {
      const ref = refOf(attr(c, 'r'));
      const col = ref ? ref.col : next;
      next = col + 1;
      if (col >= o.maxCols) { truncated = true; continue; }
      const cell = readCell(c, o);
      if (cell) { line[col] = cell; width = Math.max(width, col + 1); }
    }
  }
  for (let r = 0; r < rows.length; r++) if (!rows[r]) rows[r] = [];
  const widths = [];
  for (const col of descendants(child(root, 'cols') || { kids: [] }, 'col')) {
    const w = Number(attr(col, 'width'));
    for (let k = Number(attr(col, 'min')) - 1; k < Math.min(Number(attr(col, 'max')), o.maxCols); k++) if (w > 0) widths[k] = w;
  }
  const merges = [];
  for (const m of descendants(child(root, 'mergeCells') || { kids: [] }, 'mergeCell')) {
    const [a, b] = String(attr(m, 'ref') || '').split(':').map(refOf);
    if (a && b && a.row < o.maxRows && a.col < o.maxCols) merges.push({ r0: a.row, c0: a.col, r1: Math.min(b.row, o.maxRows - 1), c1: Math.min(b.col, o.maxCols - 1) });
  }
  return { name, rows, widths, merges, truncated, cols: width };
}

function readCell(c, o) {
  const t = attr(c, 't');
  const vEl = child(c, 'v');
  const v = vEl ? vEl.text : '';
  const style = o.xfs[Number(attr(c, 's')) || 0] || { id: 0, code: null };
  if (t === 's') { const s = o.shared[Number(v)]; return s == null || s === '' ? undefined : { text: s, kind: 'text' }; }
  if (t === 'inlineStr') { const is = child(c, 'is'); const s = is ? (child(is, 't') ? child(is, 't').text : children(is, 'r').map((r) => (child(r, 't') ? child(r, 't').text : '')).join('')) : ''; return s ? { text: s, kind: 'text' } : undefined; }
  if (t === 'str') return v === '' ? undefined : { text: v, kind: 'text' };
  if (t === 'b') return { text: v === '1' ? 'TRUE' : 'FALSE', kind: 'bool' };
  if (t === 'e') return { text: v, kind: 'error' };
  if (t === 'd') { const d = new Date(v); return Number.isNaN(+d) ? { text: v, kind: 'text' } : { text: df(o.locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(d), kind: 'number' }; }
  if (v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return { text: v, kind: 'text' };
  return { text: isDateFormat(style.id, style.code) ? formatDate(n, style.code, o.locale, o.date1904) : formatNumber(n, style.code, o.locale), kind: 'number' };
}
