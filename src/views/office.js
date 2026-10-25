// A Word, Excel or PowerPoint file in the lightbox and the Viewer: what is in it, on a white sheet like a PDF page. Not the file as
// its program draws it (no page layout, fonts, colours, charts or shapes), and never run: it is read as data and drawn with
// text nodes, so nothing in the file can reach the page.

import { el, clear } from '../core/util.js';
import { readZip } from '../media/unzip.js';
import { readDocx } from '../media/docxread.js';
import { readXlsx, colName } from '../media/xlsxread.js';
import { readPptx } from '../media/pptxread.js';
import { t, tn, dateLocale } from '../i18n/index.js';

export const OFFICE = /^(docx|xlsx|pptx)$/;
const MAX_BYTES = 30e6;
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

/**
 * @param o {source, signal, culture, fail(why), onDownload}
 * @returns {{zoomable: false, destroy()}}
 */
export function officeView(host, file, o) {
  const wrap = el('div', { class: 'gs-office', tabindex: '0', role: 'region', 'aria-label': t('Preview of {name}', { name: file.name }) });
  host.append(wrap);
  const urls = [];
  let gone = false;
  const locale = dateLocale(o.culture);
  const wait = el('div', { class: 'gs-office__wait', role: 'status', text: t('Loading') });
  wrap.append(wait);

  (async () => {
    try {
      if (file.size > MAX_BYTES) { o.fail(t('This file is too large to preview here. Download it to open it on your computer.')); wrap.remove(); return; }
      const blob = await o.source.blob(file, { signal: o.signal });
      const zip = await readZip(blob);
      if (gone) return;
      if (file.ext === 'docx') showDocx(wrap, await readDocx(zip), zip, urls, () => gone);
      else if (file.ext === 'xlsx') showXlsx(wrap, await readXlsx(zip, { locale }));
      else showPptx(wrap, await readPptx(zip));
      wait.remove();
    } catch (e) {
      if (gone || o.signal?.aborted) return;
      wrap.remove();
      o.fail(t('This file could not be previewed here. Download it to open it on your computer.'));
    }
  })();

  return { zoomable: false, destroy() { gone = true; for (const u of urls) URL.revokeObjectURL(u); wrap.remove(); } };
}

// ---- Word -------------------------------------------------------------------------------------------------

function showDocx(wrap, model, zip, urls, isGone) {
  const paper = el('article', { class: 'gs-office__paper' });
  drawBlocks(paper, model.blocks);
  if (model.truncated) paper.append(el('p', { class: 'gs-office__note', text: t('Showing the first part of the document. Download the file for the rest.') }));
  wrap.append(paper);
  // pictures come out of the zip one at a time, after the text is there
  const imgs = [...paper.querySelectorAll('img[data-path]')].slice(0, 40);
  (async () => {
    for (const img of imgs) {
      if (isGone()) return;
      const ext = (img.dataset.path.split('.').pop() || '').toLowerCase();
      const type = IMAGE_TYPES[ext];
      try {
        if (!type || !zip.has(img.dataset.path)) throw new Error('no picture');
        const bytes = await zip.bytes(img.dataset.path, 8e6);
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        urls.push(url);
        img.src = url;
      } catch { img.replaceWith(el('span', { class: 'gs-office__noimg', text: t('[picture]') })); }
    }
  })();
}

function drawBlocks(into, blocks) {
  for (const b of blocks) into.append(b.k === 'table' ? drawTable(b) : drawParagraph(b));
}

function drawParagraph(b) {
  const tag = b.heading === 0 ? 'h1' : b.heading ? `h${Math.min(6, b.heading + 1)}` : 'p';
  const p = el(tag, { class: 'gs-office__p' + (b.heading === 0 ? ' is-title' : '') + (b.heading ? ' is-h' + b.heading : '') + (b.marker != null ? ' is-item' : ''), style: { textAlign: b.align } });
  if (b.marker != null) { p.style.paddingLeft = `${(b.level + 1) * 1.7}em`; p.append(el('span', { class: 'gs-office__marker', text: b.marker })); }
  for (const r of b.runs) {
    if (r.br) { p.append(el('br')); continue; }
    if (r.img) { p.append(el('img', { class: 'gs-office__img', alt: '', dataset: { path: r.img.path }, width: r.img.w || null, height: r.img.h || null, loading: 'lazy' })); continue; }
    const text = r.t.replace(/\t/g, '    ');
    let node = r.href ? el('a', { href: r.href, target: '_blank', rel: 'noopener noreferrer', text }) : el('span', { text });
    if (r.b) node.classList.add('is-b');
    if (r.i) node.classList.add('is-i');
    if (r.u) node.classList.add('is-u');
    if (r.s) node.classList.add('is-s');
    if (r.sup) node = el('sup', {}, [node]); else if (r.sub) node = el('sub', {}, [node]);
    p.append(node);
  }
  if (!p.childNodes.length) p.append(el('br'));
  return p;
}

function drawTable(b) {
  const body = el('tbody');
  for (const row of b.rows) {
    const tr = el('tr');
    for (const c of row.cells) {
      const td = el('td', { colSpan: c.span, rowSpan: c.rowSpan });
      drawBlocks(td, c.blocks);
      tr.append(td);
    }
    body.append(tr);
  }
  return el('div', { class: 'gs-office__tblwrap' }, [el('table', { class: 'gs-office__tbl' }, [body])]);
}

// ---- Excel ------------------------------------------------------------------------------------------------

function showXlsx(wrap, model) {
  const sheets = model.sheets;
  if (!sheets.length) { wrap.append(el('p', { class: 'gs-office__note', text: t('There is nothing in this workbook to show.') })); return; }
  const stage = el('div', { class: 'gs-office__grid' });
  const tabs = el('div', { class: 'gs-office__tabs', role: 'tablist', 'aria-label': t('Sheets') });
  let current = -1;
  const show = (i) => {
    current = i;
    [...tabs.children].forEach((b, k) => { b.classList.toggle('is-on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    clear(stage).append(drawSheet(sheets[i]));
    stage.scrollTop = 0;
  };
  sheets.forEach((s, i) => tabs.append(el('button', { type: 'button', role: 'tab', class: 'gs-office__tab', text: s.name, title: s.name, onclick: () => show(i) })));
  wrap.append(stage, ...(sheets.length > 1 ? [tabs] : []));
  wrap.classList.add('is-sheet');
  show(0);
}

function drawSheet(s) {
  const cols = Math.max(1, s.cols, ...s.merges.map((m) => m.c1 + 1));
  const rows = Math.max(1, s.rows.length);
  const covered = new Set();
  const spans = new Map();
  for (const m of s.merges) {
    spans.set(`${m.r0}:${m.c0}`, { cs: m.c1 - m.c0 + 1, rs: m.r1 - m.r0 + 1 });
    for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) covered.add(`${r}:${c}`);
  }
  const px = (w) => Math.round((w || 8.43) * 7 + 5);
  const colgroup = el('colgroup', {}, [el('col', { class: 'is-corner' }), ...Array.from({ length: cols }, (_, c) => el('col', { style: { width: px(s.widths[c]) + 'px' } }))]);
  const head = el('tr', {}, [el('th', { class: 'is-corner', 'aria-hidden': 'true' }), ...Array.from({ length: cols }, (_, c) => el('th', { class: 'is-col', scope: 'col', text: colName(c) }))]);
  const body = el('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = el('tr', {}, [el('th', { class: 'is-row', scope: 'row', text: String(r + 1) })]);
    for (let c = 0; c < cols; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const cell = (s.rows[r] || [])[c];
      const sp = spans.get(`${r}:${c}`);
      tr.append(el('td', { class: cell ? 'k-' + cell.kind : 'k-empty', title: cell && cell.text.length > 40 ? cell.text : null, colSpan: sp ? sp.cs : 1, rowSpan: sp ? sp.rs : 1, text: cell ? cell.text : '' }));
    }
    body.append(tr);
  }
  const out = el('div', { class: 'gs-office__sheetwrap' }, [el('table', { class: 'gs-office__sheet' }, [colgroup, el('thead', {}, [head]), body])]);
  if (s.truncated) out.append(el('p', { class: 'gs-office__note', text: t('Showing the first {rows} rows and {cols} columns. Download the file for the rest.', { rows: rows, cols: cols }) }));
  return out;
}

// ---- PowerPoint -------------------------------------------------------------------------------------------

function showPptx(wrap, model) {
  const list = el('div', { class: 'gs-office__slides' });
  model.slides.forEach((s, i) => {
    const card = el('div', { class: 'gs-office__slide', style: { aspectRatio: String(model.ratio) } });
    if (s.title) card.append(el('h2', { class: 'gs-office__stitle', text: s.title }));
    if (s.subtitle) card.append(el('p', { class: 'gs-office__ssub', text: s.subtitle }));
    if (s.items.length) {
      const ul = el('ul', { class: 'gs-office__items' });
      for (const it of s.items) ul.append(el('li', { class: it.bullet ? 'is-bullet' : 'is-plain', style: { marginLeft: it.level * 1.4 + 'em' }, text: it.text }));
      card.append(ul);
    }
    for (const rows of s.tables) {
      card.append(el('table', { class: 'gs-office__tbl gs-office__stbl' }, [el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', { text: c })))))]));
    }
    if (s.pictures) card.append(el('p', { class: 'gs-office__note', text: tn(s.pictures, '{n} picture on this slide is not shown.', '{n} pictures on this slide are not shown.') }));
    list.append(el('section', { class: 'gs-office__slidewrap', 'aria-label': t('Slide {n} of {total}', { n: i + 1, total: model.slides.length }) }, [
      el('div', { class: 'gs-pe__label', text: t('Slide {n} of {total}', { n: i + 1, total: model.slides.length }) }), card]));
  });
  if (model.truncated) list.append(el('p', { class: 'gs-office__note', text: t('Showing the first slides. Download the file for the rest.') }));
  wrap.append(list);
}
