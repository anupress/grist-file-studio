// The words in an Office or OpenDocument file, and in an HTML file: what a search needs, not what a viewer shows.
// Pure string work on the XML (the zip is opened by unzip.js), so it can be tested without a browser.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const squash = (s) => s.replace(/[ \t\r\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Word: the text of word/document.xml, one line per paragraph. */
export function docxText(xml) {
  return squash(decode(String(xml).replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<w:br[^>]*\/>/g, '\n').replace(/<[^>]+>/g, '')));
}

/** PowerPoint: the text runs of one slide. */
export function pptxText(xml) {
  return squash(decode(String(xml).replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')));
}

/** OpenDocument (odt, ods, odp): content.xml, a line per paragraph, heading or cell. */
export function odfText(xml) {
  return squash(decode(String(xml).replace(/<\/text:(p|h)>/g, '\n').replace(/<\/table:table-cell>/g, ' ').replace(/<text:tab\/>/g, ' ').replace(/<[^>]+>/g, '')));
}

/**
 * Excel: the shared strings (every text in the workbook) plus the numbers typed into cells. A cell that points at a
 * shared string holds only its index, which is noise, so only cells of other kinds give their value.
 */
export function xlsxText(sharedStringsXml, sheetXmls = []) {
  const parts = [];
  for (const si of String(sharedStringsXml || '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    parts.push(decode([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
  }
  for (const sheet of sheetXmls) {
    const vals = [];
    for (const c of String(sheet).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (/\bt="s"/.test(c[1]) || !c[2]) continue;
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2]) || /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2]);
      if (v) vals.push(decode(v[1]));
    }
    if (vals.length) parts.push(vals.join(' '));
  }
  return squash(parts.join('\n'));
}

/** HTML: the visible words (no scripts, styles or tags). */
export function htmlText(html) {
  return squash(decode(String(html).replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')));
}
