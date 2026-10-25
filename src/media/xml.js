// A small XML reader for the files inside Word, Excel and PowerPoint documents.
//
// Why not DOMParser: it is not there in Node (so the readers cannot be tested), and a parser of our own cannot be tricked
// into fetching anything (no DTDs, no external entities: a <!DOCTYPE> is skipped, not read). It reads what Office writes:
// elements with attributes, text, CDATA, comments and the five entities plus numeric ones. Element and attribute names keep
// their prefix ("w:p", "r:id"). Text of an element is the text directly inside it, joined; the order of text relative to
// child elements is not kept (Office puts text in leaf elements such as <w:t> and <a:t>).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }
  return ENTITIES[e] ?? m;
}));

const TAG = /([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/y;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * @returns {{name: string, attrs: object, kids: object[], text: string}} a root whose only element child is the document element
 * @param o {maxNodes: stop reading after this many elements (the tree so far is returned, `truncated` set on the root)}
 */
export function parseXml(src, { maxNodes = 3e6 } = {}) {
  const s = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  const root = { name: '#root', attrs: {}, kids: [], text: '', truncated: false };
  const stack = [root];
  const n = s.length;
  let i = 0, count = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    const cur = stack[stack.length - 1];
    if (lt < 0) { cur.text += decode(s.slice(i)); break; }
    if (lt > i) cur.text += decode(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt + 9); cur.text += s.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (s[lt + 1] === '?') { const e = s.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (s[lt + 1] === '!') {   // <!DOCTYPE ...>, possibly with an internal subset in [ ]: skipped, never interpreted
      let depth = 0, k = lt + 2;
      for (; k < n; k++) { const ch = s[k]; if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === '>' && depth <= 0) break; }
      i = k + 1;
      continue;
    }
    if (s[lt + 1] === '/') {
      const e = s.indexOf('>', lt + 2);
      const name = s.slice(lt + 2, e < 0 ? n : e).trim();
      i = e < 0 ? n : e + 1;
      for (let k = stack.length - 1; k > 0; k--) { if (stack[k].name === name) { stack.length = k; break; } }
      continue;
    }
    TAG.lastIndex = lt + 1;
    const m = TAG.exec(s);
    if (!m) { i = lt + 1; cur.text += '<'; continue; }   // a stray "<": text
    if (++count > maxNodes) { root.truncated = true; break; }
    const el = { name: m[1], attrs: {}, kids: [], text: '' };
    if (m[2]) { ATTR.lastIndex = 0; let a; while ((a = ATTR.exec(m[2]))) el.attrs[a[1]] = decode(a[2] ?? a[3] ?? ''); }
    cur.kids.push(el);
    if (!m[3]) stack.push(el);
    i = TAG.lastIndex;
  }
  return root;
}

/** The document element of a parsed file. */
export const rootOf = (doc) => doc.kids[0] || { name: '', attrs: {}, kids: [], text: '' };
/** The first child element with this name, or null. */
export const child = (el, name) => (el ? el.kids.find((k) => k.name === name) || null : null);
/** Every child element with this name. */
export const children = (el, name) => (el ? el.kids.filter((k) => k.name === name) : []);
/** The value of an attribute, or undefined. */
export const attr = (el, name) => (el ? el.attrs[name] : undefined);
/** Every descendant element with this name, depth first. */
export function descendants(el, name, out = []) {
  if (!el) return out;
  for (const k of el.kids) { if (k.name === name) out.push(k); descendants(k, name, out); }
  return out;
}
/** All the text inside an element and its children, in document order of elements (text of an element before its children's). */
export function allText(el) {
  if (!el) return '';
  let s = el.text;
  for (const k of el.kids) s += allText(k);
  return s;
}
