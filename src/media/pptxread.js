// A PowerPoint presentation as slides a viewer can draw: the title, the text in the order it sits on the slide, the tables
// and a count of the pictures. Not PowerPoint: no layout, pictures, shapes or animations.
//
// Takes the zip reader of media/unzip.js. Nothing here touches the DOM.

import { parseXml, rootOf, child, children, attr, descendants } from './xml.js';

const numeric = (a, b) => a.localeCompare(b, undefined, { numeric: true });

function paragraphText(p) {
  let s = '';
  for (const k of p.kids) {
    if (k.name === 'a:r' || k.name === 'a:fld') { const t = child(k, 'a:t'); if (t) s += t.text; }
    else if (k.name === 'a:br') s += '\n';
  }
  return s;
}

/**
 * @returns {Promise<{ratio: number, slides: {title: string, subtitle: string, items: {text, level, bullet}[], tables: string[][][], pictures: number}[], truncated: boolean}>}
 */
export async function readPptx(zip, { maxSlides = 300 } = {}) {
  const names = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(numeric);
  let ratio = 16 / 9;
  if (zip.has('ppt/presentation.xml')) {
    const sz = descendants(rootOf(parseXml(await zip.text('ppt/presentation.xml', 2e6))), 'p:sldSz')[0];
    const cx = Number(attr(sz, 'cx')), cy = Number(attr(sz, 'cy'));
    if (cx > 0 && cy > 0) ratio = cx / cy;
  }
  const slides = [];
  for (const name of names.slice(0, maxSlides)) {
    const root = rootOf(parseXml(await zip.text(name, 6e6)));
    const slide = { title: '', subtitle: '', items: [], tables: [], pictures: descendants(root, 'p:pic').length };
    for (const sp of descendants(root, 'p:sp')) {
      const tx = child(sp, 'p:txBody');
      if (!tx) continue;
      const ph = descendants(child(sp, 'p:nvSpPr') || { kids: [] }, 'p:ph')[0];
      const type = ph ? attr(ph, 'type') || 'body' : null;
      for (const p of children(tx, 'a:p')) {
        const text = paragraphText(p).replace(/\s+$/g, '');
        if (!text) continue;
        if (type === 'title' || type === 'ctrTitle') slide.title += (slide.title ? ' ' : '') + text;
        else if (type === 'subTitle') slide.subtitle += (slide.subtitle ? ' ' : '') + text;
        else {
          const pr = child(p, 'a:pPr');
          const bullet = child(pr, 'a:buNone') ? false : !!(child(pr, 'a:buChar') || child(pr, 'a:buAutoNum')) || type === 'body';
          slide.items.push({ text, level: Number(attr(pr, 'lvl')) || 0, bullet });
        }
      }
    }
    for (const tbl of descendants(root, 'a:tbl')) {
      slide.tables.push(children(tbl, 'a:tr').map((tr) => children(tr, 'a:tc').map((tc) => descendants(tc, 'a:p').map(paragraphText).filter(Boolean).join(' '))));
    }
    slides.push(slide);
  }
  return { ratio, slides, truncated: names.length > maxSlides };
}
