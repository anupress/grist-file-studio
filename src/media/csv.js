// CSV and TSV, read and written back the way the file had them: its delimiter (comma, semicolon as
// German Excel writes, or tab), its line endings, its byte-order mark and whether it ended with a
// line break. A file opened and saved without edits comes out the same, unless its quoting was odd.
// Pure: tested in tests/text.test.mjs.

/** Line endings, BOM, final newline and delimiter of a text. */
export function detectDialect(text, ext = 'csv') {
  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  const crlf = (body.match(/\r\n/g) || []).length;
  const lf = (body.match(/(^|[^\r])\n/g) || []).length;
  const eol = crlf > lf ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(body);
  let sep = ext === 'tsv' ? '\t' : ',';
  if (ext !== 'tsv') {
    // The delimiter is whichever appears most often outside quotes in the first lines.
    const head = body.split(/\r?\n/).slice(0, 10).join('\n').replace(/"[^"]*"/g, '');
    const count = (c) => head.split(c).length - 1;
    const best = [',', ';', '\t', '|'].map((c) => [c, count(c)]).sort((a, b) => b[1] - a[1])[0];
    if (best[1] > 0) sep = best[0];
  }
  return { bom, eol, trailing, sep };
}

/** Text -> rows of cells, RFC 4180 quoting (doubled quotes, line breaks inside quotes). */
export function parseCsv(text, sep = ',') {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [], cell = '', q = false, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { q = true; i++; continue; }
    if (ch === sep) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Rows -> text in the given dialect. A cell is quoted only when it has to be. */
export function toCsv(rows, { sep = ',', eol = '\n', bom = false, trailing = true } = {}) {
  const needs = new RegExp(`["\\r\\n${sep === '\t' ? '\\t' : sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]|^\\s|\\s$`);
  const cell = (v) => { const s = v == null ? '' : String(v); return needs.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const text = rows.map((r) => r.map(cell).join(sep)).join(eol) + (trailing && rows.length ? eol : '');
  return (bom ? '﻿' : '') + text;
}

/** Rows made rectangular (every row as long as the longest), for the table editor. */
export function squareUp(rows) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r.slice()));
}

/** Spreadsheet column names: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** A text's line endings, BOM and final newline, so a plain text file is saved back the way it came. */
export function textDialect(text) {
  const { bom, eol, trailing } = detectDialect(text, 'txt');
  return { bom, eol, trailing };
}

/** Editor text (always \n inside) -> file text in the file's own dialect. */
export function toFileText(text, { bom = false, eol = '\n' } = {}) {
  return (bom ? '﻿' : '') + (eol === '\n' ? text : text.replace(/\n/g, eol));
}
