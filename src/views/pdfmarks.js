// The pages as sheets in one column, for four tabs of the PDF editor:
//   'mark'   fill and sign: place text, a date, ticks, covers, highlights, pen strokes and a signature, then move,
//            resize and change them;
//   'number' page numbers and a watermark, shown on the sheets as they will be saved;
//   'form'   the PDF's own form fields as inputs on the pages;
//   'finish' pages as pictures (true redaction, smaller files) and a password, with the sheets as they will be saved.
//
// Marks live in ctx.S.marks (page id -> list) in the DISPLAY frame (see media/pdfops.js). A mark is never changed in
// place: a change makes a new object, so the editor's history can keep cheap snapshots.

import { el, clear, fromHTML } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { renderPage } from '../media/pdf.js';
import { stampElements, numberLabel, unsupportedChars, widgetBox, norm } from '../media/pdfops.js';
import { renderMark, RESIZABLE, KEEPS_SHAPE } from './pdfelements.js';
import { group, chips, swatches, slider, button } from '../ui/controls.js';
import { openSignPad } from '../ui/signpad.js';
import { t, tn } from '../i18n/index.js';
import { decodeBitmap } from '../media/picture.js';

const TOOL_LABELS = { select: 'Select', text: 'Text', date: 'Date', check: 'Tick', cross: 'Cross', rect: 'Cover up', hilite: 'Highlight', draw: 'Pen', image: 'Signature', logo: 'Picture' };
const HINT_LABELS = {
  select: 'Click a mark to move it. Drag its corners to resize. Double-click text to change it.',
  text: 'Click the page where the text should go.',
  date: 'Click the page where today’s date should go.',
  check: 'Click to put a tick. The tool stays on until you pick Select.',
  cross: 'Click to put a cross. The tool stays on until you pick Select.',
  rect: 'Drag over what to cover. A cover hides it from view and print, but the text under it stays in the file until you turn the page into a picture (tab Finish).',
  hilite: 'Drag over what to highlight.',
  draw: 'Drag on the page to draw.',
  image: 'Click the page where the signature should go.',
  logo: 'Click the page where the picture should go.',
};
const COLOUR_LABELS = { Black: 'Black', Blue: 'Blue', Red: 'Red', Green: 'Green', White: 'White', Grey: 'Grey', Yellow: 'Yellow', Pink: 'Pink' };
const FONT_LABELS = { sans: 'Sans', serif: 'Serif', mono: 'Mono' };
const INK = [['#111827', 'Black'], ['#1d4ed8', 'Blue'], ['#c42b33', 'Red'], ['#15803d', 'Green']];
const COVER = [['#ffffff', 'White'], ['#111827', 'Black'], ['#9ca3af', 'Grey']];
const MARKER = [['#ffd60a', 'Yellow'], ['#4ade80', 'Green'], ['#f472b6', 'Pink'], ['#60a5fa', 'Blue']];
const STAMP_INK = [['#6b7280', 'Grey'], ['#c42b33', 'Red'], ['#1d4ed8', 'Blue']];
const NUMBER_FORMATS = ['n', 'n-of-m', 'page-n', 'page-n-of-m'];
const PLACING = new Set(['text', 'date', 'check', 'cross', 'image', 'logo']);   // tools that go back to Select after one mark

const ico = (body) => fromHTML(`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);
const TOOL_ICONS = {
  select: () => ico('<path d="M5 3l14 8-6.5 1.6L9 19z"/>'),
  text: () => icon('type'), date: () => icon('calendar'), check: () => icon('check'), cross: () => icon('close'),
  rect: () => ico('<rect x="3.5" y="7" width="17" height="10" rx="1.5" fill="currentColor"/>'),
  hilite: () => ico('<path d="M14.5 4.5l5 5-8 8-5.2.7.7-5.2z"/><path d="M4 21h8"/>'),
  draw: () => icon('edit'),
  image: () => ico('<path d="M3 17c2.5-6 3.7-10 5.5-10 2.5 0 .2 9 3 9 2 0 2.2-5 4-5 1.5 0 1.5 3 4.5 3"/><path d="M3 21h18"/>'),
  logo: () => icon('image2'),
};

const DEFAULTS = () => ({
  text: { size: 14, font: 'sans', bold: false, italic: false, color: '#111827' },
  check: { w: 18, h: 18, color: '#111827', weight: 2 }, cross: { w: 18, h: 18, color: '#111827', weight: 2 },
  rect: { color: '#ffffff' }, hilite: { color: '#ffd60a' }, draw: { color: '#1d4ed8', width: 2 }, image: {}, logo: {},
});

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Choose a picture file and make it ready to place: at most 1000 px, a JPEG stays a JPEG, anything else keeps its transparency as a PNG. */
function pickPicture(root) {
  return new Promise((resolve, reject) => {
    const input = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const finish = (v) => { input.remove(); resolve(v); };
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) { finish(null); return; }
      try {
        const bmp = await decodeBitmap(file, { imageOrientation: 'from-image' });
        const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
        const x = c.getContext('2d');
        const jpeg = /^image\/jpe?g$/i.test(file.type);
        if (jpeg) { x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(bmp, 0, 0, c.width, c.height);
        if (bmp.close) bmp.close();
        finish({ dataUrl: c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9), w: c.width, h: c.height });
      } catch (e) { input.remove(); reject(e); }
    });
    input.addEventListener('cancel', () => finish(null));
    root.append(input);
    input.click();
  });
}

/**
 * @param ctx the editor: {S, kept(), pageSize(entry), sources, root, commit(fn, opts), repanel(), toast(msg), newId(), today(), onUnsupported(chars)}
 * @param mode 'mark' | 'number' | 'form' | 'finish'
 */
export function createMarksView(ctx, mode) {
  const sheets = el('div', { class: 'gs-pe__sheets' });
  const stage = el('div', { class: 'gs-ed__stage gs-pe__stage gs-pe__stage--sheets' }, [sheets]);
  let tool = 'select', sel = null, pending = null, pendingPic = null, zoom = 1, rebuildKey = '', widthNow = 0;
  const dflt = DEFAULTS();
  const live = new Map();            // page id -> {wrap, sheet, canvas, layer, drawnKey}
  const queue = [];
  let running = 0;

  // ---- geometry of a sheet ----
  const sheetWidth = () => Math.round(Math.max(240, Math.min(980, stage.clientWidth - 56)) * zoom);
  function metrics(entry) {
    const { w: Wd, h: Hd } = ctx.pageSize(entry);
    const w = widthNow, k = w / Wd;
    return { w, h: Hd * k, Wd, Hd, k };
  }
  const entryOf = (pageId) => ctx.S.pages.find((p) => p.id === pageId);
  const marksOf = (pageId) => ctx.S.marks.get(pageId) || [];
  const find = (pageId, id) => marksOf(pageId).find((m) => m.id === id);
  const selMark = () => (sel ? find(sel.page, sel.id) : null);

  // ---- building the sheets ----
  function build() {
    widthNow = sheetWidth();
    const pages = ctx.kept();
    const key = pages.map((p) => `${p.id}:${p.rot}`).join(',') + '|' + widthNow;
    if (key === rebuildKey) { for (const p of pages) renderLayer(p.id); return; }
    rebuildKey = key;
    io.disconnect();
    clear(sheets);
    live.clear();
    pages.forEach((p, i) => {
      const m = metrics(p);
      const canvas = el('canvas', { class: 'gs-pe__page', 'aria-hidden': 'true' });
      const layer = el('div', { class: 'gs-pe__layer', dataset: { page: p.id } });
      const sheet = el('div', { class: 'gs-pe__sheet', style: { width: m.w + 'px', height: m.h + 'px' } }, [canvas, layer]);
      const wrap = el('section', { class: 'gs-pe__sheetwrap', 'aria-label': t('Page {n} of {total}', { n: i + 1, total: pages.length }) }, [
        el('div', { class: 'gs-pe__label', text: t('Page {n} of {total}', { n: i + 1, total: pages.length }) }), sheet]);
      sheets.append(wrap);
      live.set(p.id, { wrap, sheet, canvas, layer, drawnKey: '' });
      wrap.dataset.page = p.id;
      io.observe(wrap);
      renderLayer(p.id);
    });
    if (sel && !live.has(sel.page)) sel = null;
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = live.get(e.target.dataset.page);
      if (!v) continue;
      if (e.isIntersecting) { if (!v.queued) { v.queued = true; queue.push(e.target.dataset.page); pump(); } }
      else if (v.drawnKey) { v.canvas.width = 1; v.canvas.height = 1; v.drawnKey = ''; v.queued = false; }   // far away: give the memory back
    }
  }, { root: stage, rootMargin: '1200px 0px' });

  function pump() {
    while (running < 2 && queue.length) {
      const id = queue.shift();
      const v = live.get(id), entry = entryOf(id);
      if (!v || !entry) continue;
      running++;
      const src = ctx.sources.get(entry.src);
      const w = widthNow;
      renderPage(src.doc, entry.page + 1, v.canvas, w, { rotation: entry.rot })
        .then(() => { v.drawnKey = `${entry.rot}|${w}`; })
        .catch(() => {})
        .finally(() => { v.queued = false; running--; pump(); });
    }
  }

  // ---- the marks of one page ----
  function renderLayer(pageId, override = null) {
    const v = live.get(pageId), entry = entryOf(pageId);
    if (!v || !entry) return;
    const m = metrics(entry);
    const list = marksOf(pageId).map((x) => (override && override.id === x.id ? override : x));
    const idx = ctx.kept().findIndex((p) => p.id === pageId);
    const stamps = stampElements(ctx.S.stamp, idx, ctx.kept().length, m.Wd, m.Hd);
    v.layer.replaceChildren(
      ...list.map((x) => renderMark(x, m)),
      ...stamps.map((x) => renderMark(x, m, { locked: true })),
      ...(mode === 'form' ? formNodes(entry, m) : []),
    );
    if (override) return;
    if (sel && sel.page === pageId && mode === 'mark') drawFrame(v, m, list.find((x) => x.id === sel.id));
  }

  function drawFrame(v, m, mk) {
    if (!mk) { sel = null; return; }
    const node = v.layer.querySelector(`[data-mark="${mk.id}"]`);
    if (!node) return;
    const target = mk.type === 'draw' ? node.querySelector('path') : node;
    const r = target.getBoundingClientRect(), L = v.layer.getBoundingClientRect();
    const frame = el('div', { class: 'gs-pe__frame', style: { left: r.left - L.left - 2 + 'px', top: r.top - L.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' } });
    if (RESIZABLE.has(mk.type) && (mk.angle || 0) % 90 === 0) {
      for (const h of ['nw', 'ne', 'sw', 'se']) frame.append(el('div', { class: 'gs-pe__handle gs-pe__handle--' + h, dataset: { handle: h } }));
    }
    v.layer.append(frame);
  }

  // ---- changing marks ----
  const setMark = (pageId, mk) => ctx.S.marks.set(pageId, marksOf(pageId).map((x) => (x.id === mk.id ? mk : x)));
  const addMark = (pageId, mk) => ctx.S.marks.set(pageId, [...marksOf(pageId), mk]);
  function change(patch, opts = {}) {
    const mk = selMark();
    if (!mk) return;
    const next = { ...mk, ...patch };
    ctx.commit((S) => setMark(sel.page, next), { coalesce: opts.coalesce || null, keepPanel: true });
  }
  function select(pageId, id) {
    const same = sel && sel.page === pageId && sel.id === id;
    sel = id ? { page: pageId, id } : null;
    if (!same) { for (const p of ctx.kept()) renderLayer(p.id); ctx.repanel(); }
  }
  function remove(pageId, id) {
    ctx.commit((S) => S.marks.set(pageId, marksOf(pageId).filter((x) => x.id !== id)));
    if (sel && sel.id === id) { sel = null; ctx.repanel(); }
  }

  // ---- pointer work ----
  const fracOf = (e, layer) => { const r = layer.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  function track(onMove, onUp) {
    const move = (ev) => onMove(ev);
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); onUp(ev); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  const shifted = (mk, dx, dy) => (mk.type === 'draw'
    ? { ...mk, points: mk.points.map(([x, y]) => [x + dx, y + dy]) }
    : { ...mk, x: clamp01(mk.x + dx), y: clamp01(mk.y + dy) });

  function startMove(e, pageId, mk) {
    const layer = live.get(pageId).layer, m = metrics(entryOf(pageId)), start = fracOf(e, layer);
    let cur = mk, moved = false;
    track((ev) => {
      const p = fracOf(ev, layer), dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.hypot(dx * m.w, dy * m.h) < 3) return;
      moved = true;
      cur = shifted(mk, dx, dy);
      renderLayer(pageId, cur);
    }, () => {
      if (moved) ctx.commit((S) => setMark(pageId, cur)); else renderLayer(pageId);
    });
  }

  function startResize(e, pageId, mk, handle) {
    const v = live.get(pageId), m = metrics(entryOf(pageId));
    const node = v.layer.querySelector(`[data-mark="${mk.id}"]`);
    const r = node.getBoundingClientRect(), L = v.layer.getBoundingClientRect();
    const box = { x: r.left - L.left, y: r.top - L.top, w: r.width, h: r.height };
    const fixed = { x: handle.includes('w') ? box.x + box.w : box.x, y: handle.includes('n') ? box.y + box.h : box.y };
    let cur = mk;
    track((ev) => {
      const px = ev.clientX - L.left, py = ev.clientY - L.top;
      let w = Math.max(8, Math.abs(px - fixed.x)), h = Math.max(8, Math.abs(py - fixed.y));
      if (KEEPS_SHAPE.has(mk.type)) { const s = Math.max(w / box.w, h / box.h); w = box.w * s; h = box.h * s; }
      const bx = px < fixed.x ? fixed.x - w : fixed.x, by = py < fixed.y ? fixed.y - h : fixed.y;
      const sideways = ((mk.angle || 0) % 180) === 90;
      cur = { ...mk, x: (bx + w / 2) / m.w, y: (by + h / 2) / m.h, w: (sideways ? h : w) / m.k, h: (sideways ? w : h) / m.k };
      renderLayer(pageId, cur);
    }, () => { ctx.commit((S) => setMark(pageId, cur)); });
  }

  function startRubber(e, pageId, type) {
    const layer = live.get(pageId).layer, m = metrics(entryOf(pageId)), a = fracOf(e, layer);
    const color = dflt[type].color;
    const make = (b) => ({ id: 'tmp', type, color, angle: 0, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.abs(a.x - b.x) * m.Wd, h: Math.abs(a.y - b.y) * m.Hd });
    let cur = null;
    track((ev) => { cur = make(fracOf(ev, layer)); renderLayer(pageId, cur); }, (ev) => {
      const b = fracOf(ev, layer);
      let mk = make(b);
      if (Math.hypot((a.x - b.x) * m.w, (a.y - b.y) * m.h) < 5) mk = { ...mk, x: clamp01(a.x), y: clamp01(a.y), w: type === 'rect' ? 110 : 120, h: type === 'rect' ? 22 : 13 };
      mk = { ...mk, id: ctx.newId('m') };
      ctx.commit((S) => addMark(pageId, mk));
      select(pageId, mk.id);
    });
  }

  function startPen(e, pageId) {
    const layer = live.get(pageId).layer, m = metrics(entryOf(pageId));
    const pts = [[fracOf(e, layer).x, fracOf(e, layer).y]];
    const mk = () => ({ id: 'tmp', type: 'draw', points: pts.length > 1 ? pts : [pts[0], [pts[0][0] + 0.0005, pts[0][1]]], color: dflt.draw.color, width: dflt.draw.width });
    track((ev) => {
      const p = fracOf(ev, layer), last = pts[pts.length - 1];
      if (Math.hypot((p.x - last[0]) * m.w, (p.y - last[1]) * m.h) < 2) return;
      pts.push([p.x, p.y]);
      renderLayer(pageId, mk());
    }, () => {
      const made = { ...mk(), id: ctx.newId('m') };
      ctx.commit((S) => addMark(pageId, made));
      select(pageId, made.id);
    });
  }

  function place(e, pageId) {
    const layer = live.get(pageId).layer, m = metrics(entryOf(pageId)), p = fracOf(e, layer);
    const at = { x: clamp01(p.x), y: clamp01(p.y), angle: 0 };
    if (tool === 'text') {
      editText(pageId, { id: ctx.newId('m'), type: 'text', text: '', align: 'left', ...dflt.text, ...at }, true);
    } else if (tool === 'date') {
      const mk = { id: ctx.newId('m'), type: 'text', text: ctx.today(), align: 'left', ...dflt.text, ...at };
      ctx.commit((S) => addMark(pageId, mk)); select(pageId, mk.id); setTool('select');
    } else if (tool === 'check' || tool === 'cross') {
      const mk = { id: ctx.newId('m'), type: tool, ...dflt[tool], ...at };
      ctx.commit((S) => addMark(pageId, mk)); select(pageId, mk.id);
    } else if (tool === 'image' && pending) {
      const k = Math.min(150 / pending.w, 64 / pending.h);
      const mk = { id: ctx.newId('m'), type: 'image', dataUrl: pending.dataUrl, w: pending.w * k, h: pending.h * k, ...at };
      ctx.commit((S) => addMark(pageId, mk)); select(pageId, mk.id); setTool('select');
    } else if (tool === 'logo' && pendingPic) {
      const k = 140 / Math.max(pendingPic.w, pendingPic.h);
      const mk = { id: ctx.newId('m'), type: 'image', dataUrl: pendingPic.dataUrl, w: pendingPic.w * k, h: pendingPic.h * k, ...at };
      ctx.commit((S) => addMark(pageId, mk)); select(pageId, mk.id); setTool('select');
    }
  }

  sheets.addEventListener('pointerdown', (e) => {
    if (mode !== 'mark' || e.button !== 0) return;
    const layer = e.target.closest('.gs-pe__layer');
    if (!layer) return;
    const pageId = layer.dataset.page;
    const handle = e.target.closest('[data-handle]');
    const node = e.target.closest('[data-mark]');
    if (handle && sel) { e.preventDefault(); startResize(e, pageId, selMark(), handle.dataset.handle); return; }
    if (node && !node.classList.contains('is-locked') && node.dataset.mark !== 'tmp') {
      e.preventDefault();
      const mk = find(pageId, node.dataset.mark);
      if (mk) { select(pageId, mk.id); startMove(e, pageId, mk); return; }
    }
    if (e.target.closest('.gs-pe__frame') && sel) { e.preventDefault(); startMove(e, pageId, selMark()); return; }
    e.preventDefault();
    if (tool === 'select') { select(null, null); return; }
    if (tool === 'rect' || tool === 'hilite') startRubber(e, pageId, tool);
    else if (tool === 'draw') startPen(e, pageId);
    else place(e, pageId);
  });
  sheets.addEventListener('dblclick', (e) => {
    const node = e.target.closest('[data-mark]');
    const layer = e.target.closest('.gs-pe__layer');
    if (mode !== 'mark' || !node || !layer) return;
    const mk = find(layer.dataset.page, node.dataset.mark);
    if (mk && mk.type === 'text') editText(layer.dataset.page, mk, false);
  });

  // ---- text on the page ----
  function editText(pageId, mk, isNew) {
    const v = live.get(pageId), m = metrics(entryOf(pageId));
    const node = v.layer.querySelector(`[data-mark="${mk.id}"]`);
    if (node) node.style.visibility = 'hidden';
    const ghost = renderMark({ ...mk, text: 'x' }, m);
    const ta = el('textarea', { class: 'gs-pe__edit', value: mk.text, spellcheck: false, rows: 1, 'aria-label': t('Text on the page') });
    Object.assign(ta.style, {
      left: ghost.style.left, top: ghost.style.top, transformOrigin: '0 0', transform: ghost.style.transform, fontSize: ghost.style.fontSize, lineHeight: ghost.style.lineHeight,
      fontFamily: ghost.style.fontFamily, fontWeight: ghost.style.fontWeight, fontStyle: ghost.style.fontStyle, color: mk.color, textAlign: mk.align || 'left',
    });
    v.layer.append(ta);
    const fit = () => { ta.style.height = '0'; ta.style.height = ta.scrollHeight + 'px'; ta.style.width = '0'; ta.style.width = Math.max(40, ta.scrollWidth + 6) + 'px'; };
    ta.addEventListener('input', fit);
    let closed = false;
    const finish = (keepIt) => {
      if (closed) return;
      closed = true;
      const text = ta.value.replace(/\s+$/g, '');
      ta.remove();
      if (!keepIt || text === mk.text) { renderLayer(pageId); return; }
      if (!text) { if (!isNew) remove(pageId, mk.id); else renderLayer(pageId); return; }
      const next = { ...mk, text };
      ctx.commit((S) => (isNew ? addMark(pageId, next) : setMark(pageId, next)));
      ctx.onUnsupported(unsupportedChars(ctx.charset, text));
      select(pageId, next.id);
      if (isNew) setTool('select');
    };
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
      e.stopPropagation();
    });
    fit();
    ta.focus();
    ta.select();
  }

  // ---- tools and the panel ----
  async function setTool(next) {
    if (next === 'image') {
      const sig = await openSignPad(ctx.root);
      if (!sig) return;
      pending = sig;
    }
    if (next === 'logo') {
      let pic = null;
      try { pic = await pickPicture(ctx.root); } catch { ctx.toast(t('That file is not a picture this browser can read.')); return; }
      if (!pic) return;
      pendingPic = pic;
    }
    tool = next;
    stage.dataset.tool = tool;
    if (tool !== 'select') { sel = null; for (const p of ctx.kept()) renderLayer(p.id); }
    ctx.repanel();
  }

  /** Values to show: the selected mark's, or the defaults for the tool in hand. */
  function current(type) { return selMark() && selMark().type === type ? selMark() : dflt[type]; }
  function setProp(type, patch, coalesce) {
    if (selMark() && selMark().type === type) change(patch, { coalesce });
    else Object.assign(dflt[type], patch);
  }

  function markPanel(body) {
    const s = selMark();
    const kind = s ? (s.type === 'text' ? 'text' : s.type) : tool === 'date' ? 'text' : tool;
    body.append(
      group(t('Put on the page'), chips(Object.keys(TOOL_LABELS).map((id) => [id, t(TOOL_LABELS[id]), TOOL_ICONS[id]()]), s ? 'select' : tool, (id) => setTool(id), { label: t('Tool') })),
      el('p', { class: 'gs-hint', text: t(HINT_LABELS[s ? 'select' : tool]) }),
    );
    if (kind === 'text') {
      const c = current('text');
      body.append(group(s ? t('This text') : t('Text'),
        chips(Object.keys(FONT_LABELS).map((id) => [id, t(FONT_LABELS[id])]), c.font, (id) => { setProp('text', { font: id }); ctx.repanel(); }, { label: t('Font') }),
        el('div', { class: 'gs-ed__row' }, [
          button(null, t('Bold'), () => { setProp('text', { bold: !c.bold }); ctx.repanel(); }, { class: 'gs-btn' + (c.bold ? ' is-on' : ''), 'aria-pressed': c.bold ? 'true' : 'false', style: { fontWeight: '700' } }),
          button(null, t('Italic'), () => { setProp('text', { italic: !c.italic }); ctx.repanel(); }, { class: 'gs-btn' + (c.italic ? ' is-on' : ''), 'aria-pressed': c.italic ? 'true' : 'false', style: { fontStyle: 'italic' } }),
        ]),
        slider(t('Size'), 6, 72, 1, c.size, { format: (v) => `${v} pt`, onInput: (v) => setProp('text', { size: v }, 'size'), onChange: () => {} }),
        swatches(INK.map(([h, n]) => [h, t(COLOUR_LABELS[n])]), c.color, (hex) => { setProp('text', { color: hex }); ctx.repanel(); }),
        el('p', { class: 'gs-hint', text: t('Letters the PDF’s standard fonts do not have, such as Greek or Chinese, would turn into “?”. German, French and other Western European text is fine.') }),
      ));
    } else if (kind === 'check' || kind === 'cross') {
      const c = current(kind);
      body.append(group(t('Size and colour'),
        slider(t('Size'), 10, 60, 1, c.w, { format: (v) => `${v} pt`, onInput: (v) => setProp(kind, { w: v, h: v }, 'size') }),
        swatches(INK.map(([h, n]) => [h, t(COLOUR_LABELS[n])]), c.color, (hex) => { setProp(kind, { color: hex }); ctx.repanel(); }),
      ));
    } else if (kind === 'rect') {
      body.append(group(t('Cover colour'), swatches(COVER.map(([h, n]) => [h, t(COLOUR_LABELS[n])]), current('rect').color, (hex) => { setProp('rect', { color: hex }); ctx.repanel(); })));
    } else if (kind === 'hilite') {
      body.append(group(t('Highlighter'), swatches(MARKER.map(([h, n]) => [h, t(COLOUR_LABELS[n])]), current('hilite').color, (hex) => { setProp('hilite', { color: hex }); ctx.repanel(); })));
    } else if (kind === 'draw') {
      const c = current('draw');
      body.append(group(t('Pen'),
        slider(t('Thickness'), 1, 8, 0.5, c.width, { format: (v) => `${v} pt`, onInput: (v) => setProp('draw', { width: v }, 'width') }),
        swatches(INK.map(([h, n]) => [h, t(COLOUR_LABELS[n])]), c.color, (hex) => { setProp('draw', { color: hex }); ctx.repanel(); }),
      ));
    } else if (kind === 'logo' && pendingPic) {
      body.append(group(t('Your picture'), el('img', { class: 'gs-pe__sigpreview', src: pendingPic.dataUrl, alt: t('Your picture') }),
        button(null, t('Choose another picture…'), () => { pendingPic = null; setTool('logo'); })));
    } else if (kind === 'image') {
      const c = selMark();
      if (c) {
        body.append(group(t('Size'), slider(t('Width'), 30, 400, 1, Math.round(c.w), { format: (v) => `${v} pt`, onInput: (v) => change({ w: v, h: v * (c.h / c.w) }, { coalesce: 'size' }) })));
      } else if (pending) {
        body.append(group(t('Your signature'), el('img', { class: 'gs-pe__sigpreview', src: pending.dataUrl, alt: t('Your signature') }),
          button(null, t('Draw it again…'), () => { pending = null; setTool('image'); })));
      }
    }
    if (s) {
      body.append(group(t('This mark'), el('div', { class: 'gs-ed__row' }, [
        button(icon('trash'), t('Delete this mark'), () => remove(sel.page, sel.id)),
        button(null, t('Done'), () => select(null, null)),
      ])));
    }
    const total = [...ctx.S.marks.values()].reduce((n, l) => n + l.length, 0);
    body.append(group(t('On the pages'), el('p', { class: 'gs-hint', text: total ? tn(total, '{n} mark so far.', '{n} marks so far.') : t('Nothing is on the pages yet.') }),
      total ? button(icon('trash'), t('Remove all marks'), () => { ctx.commit((S) => S.marks.clear()); sel = null; ctx.repanel(); }) : null));
  }

  function numberPanel(body) {
    const st = ctx.S.stamp, nm = st.numbers, wm = st.watermark;
    const kept = ctx.kept().length;
    const set = (which, patch, coalesce, keep = false) => ctx.commit((S) => Object.assign(S.stamp[which], patch), { coalesce, keepPanel: keep });
    const pos = nm.position || 'bc', vert = pos[0], horiz = pos[1];
    const sample = (f) => numberLabel({ ...nm, format: f, skipFirst: false }, Math.min(1, kept - 1), kept) || '1';
    body.append(
      group(t('Page numbers'),
        el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: nm.on, onchange: (e) => set('numbers', { on: e.target.checked }) }), t('Number the pages')]),
        ...(nm.on ? [
          chips([['t', t('Top')], ['b', t('Bottom')]], vert, (v) => set('numbers', { position: v + horiz }), { label: t('Vertical position') }),
          chips([['l', t('Left')], ['c', t('Centre')], ['r', t('Right')]], horiz, (h) => set('numbers', { position: vert + h }), { label: t('Horizontal position') }),
          el('label', { class: 'gs-field' }, [el('span', { class: 'gs-label', text: t('Look') }), el('select', { class: 'gs-input', onchange: (e) => set('numbers', { format: e.target.value }) },
            NUMBER_FORMATS.map((f) => el('option', { value: f, selected: f === nm.format, text: sample(f) })))]),
          el('label', { class: 'gs-field' }, [el('span', { class: 'gs-label', text: t('Start at') }),
            el('input', { class: 'gs-input gs-ed__num', type: 'number', min: 0, max: 9999, value: nm.start, oninput: (e) => set('numbers', { start: Math.max(0, Math.floor(Number(e.target.value) || 0)) }, 'start', true) })]),
          el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: nm.skipFirst, onchange: (e) => set('numbers', { skipFirst: e.target.checked }) }), t('Leave the first page without a number')]),
          slider(t('Size'), 7, 20, 1, nm.size, { format: (v) => `${v} pt`, onInput: (v) => set('numbers', { size: v }, 'nsize', true) }),
        ] : []),
      ),
      group(t('Watermark'),
        el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: wm.on, onchange: (e) => set('watermark', { on: e.target.checked }) }), t('Put a word across every page')]),
        ...(wm.on ? [
          el('label', { class: 'gs-field' }, [el('span', { class: 'gs-label', text: t('Word') }),
            el('input', { class: 'gs-input', type: 'text', maxlength: 40, value: wm.text, placeholder: t('DRAFT'), oninput: (e) => set('watermark', { text: e.target.value }, 'wtext', true) })]),
          slider(t('Size'), 24, 160, 1, wm.size, { format: (v) => `${v} pt`, onInput: (v) => set('watermark', { size: v }, 'wsize', true) }),
          slider(t('Strength'), 5, 60, 1, Math.round(wm.opacity * 100), { format: (v) => `${v} %`, onInput: (v) => set('watermark', { opacity: v / 100 }, 'wop', true) }),
          el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: wm.diagonal, onchange: (e) => set('watermark', { diagonal: e.target.checked }) }), t('Diagonal')]),
          swatches(STAMP_INK.map(([h, n]) => [h, t(COLOUR_LABELS[n])]), wm.color, (hex) => set('watermark', { color: hex })),
        ] : []),
      ),
      el('p', { class: 'gs-hint', text: t('Numbers and the watermark go on every page of the saved file, and on every file you split off.') }),
    );
  }

  // ---- form fields on the sheets (tab 'form') ----
  // A field of the PDF's own form is drawn as an input on top of the page, where its widget is. What is typed is kept in
  // ctx.S.form.values under "<source id>|<field name>" and written into the file when it is saved (see buildPdf).
  const fieldValue = (f, key) => (key in ctx.S.form.values ? ctx.S.form.values[key] : f.value);
  const entriesUi = { note: null, clear: null };
  /** The count and the Clear button of the Form panel follow what is typed, without redrawing the panel (the field would lose the keyboard). */
  function showEntries() {
    const n = Object.keys(ctx.S.form.values).length;
    if (entriesUi.note) entriesUi.note.textContent = n ? tn(n, '{n} field filled in so far.', '{n} fields filled in so far.') : t('Nothing is filled in yet.');
    if (entriesUi.clear) entriesUi.clear.disabled = !n;
  }
  const setField = (key, value) => { ctx.commit((S) => { S.form.values[key] = value; }, { coalesce: 'field:' + key, quiet: true }); showEntries(); };

  function fieldNode(f, w, key, b, m) {
    const at = { left: b.x * m.w + 'px', top: b.y * m.h + 'px', width: b.w * m.w + 'px', height: b.h * m.h + 'px' };
    const hpx = b.h * m.h;
    let node;
    if (f.kind === 'text') {
      const multi = f.multiline;
      node = el(multi ? 'textarea' : 'input', {
        class: 'gs-pe__field', ...(multi ? {} : { type: 'text' }), value: String(fieldValue(f, key) ?? ''), maxlength: f.maxLength || null,
        spellcheck: false, 'aria-label': f.name, oninput: () => setField(key, node.value),
      });
      node.style.fontSize = (multi ? Math.max(8, Math.min(13, m.k * 10)) : Math.max(7, Math.min(15, hpx * 0.62))) + 'px';
    } else if (f.kind === 'check') {
      node = el('input', { type: 'checkbox', class: 'gs-pe__field gs-pe__field--tick', checked: !!fieldValue(f, key), 'aria-label': f.name, onchange: () => setField(key, node.checked) });
    } else if (f.kind === 'radio') {
      node = el('input', { type: 'radio', class: 'gs-pe__field gs-pe__field--tick', name: key, checked: fieldValue(f, key) === w.option, 'aria-label': `${f.name}: ${w.option ?? ''}`, onchange: () => { if (node.checked) setField(key, w.option); } });
    } else if (f.kind === 'dropdown') {
      const cur = fieldValue(f, key) ?? '';
      node = el('select', { class: 'gs-pe__field', 'aria-label': f.name, onchange: () => setField(key, node.value) },
        ['', ...f.options].map((o) => el('option', { value: o, text: o, selected: o === cur })));
      node.style.fontSize = Math.max(7, Math.min(15, hpx * 0.6)) + 'px';
    } else {
      const cur = new Set([].concat(fieldValue(f, key) || []));
      node = el('select', { class: 'gs-pe__field', multiple: !!f.multi, size: Math.max(2, Math.round(hpx / 14)), 'aria-label': f.name,
        onchange: () => setField(key, [...node.selectedOptions].map((o) => o.value)) },
      f.options.map((o) => el('option', { value: o, text: o, selected: cur.has(o) })));
      node.style.fontSize = '11px';
    }
    if (f.kind === 'check' || f.kind === 'radio') {
      const side = Math.max(10, Math.min(b.w * m.w, hpx));
      Object.assign(node.style, { left: b.x * m.w + (b.w * m.w - side) / 2 + 'px', top: b.y * m.h + (hpx - side) / 2 + 'px', width: side + 'px', height: side + 'px' });
    } else Object.assign(node.style, at);
    return node;
  }

  /** The inputs of one page. */
  function formNodes(entry, m) {
    const src = ctx.sources.get(entry.src);
    const info = src.pages && src.pages[entry.page];
    if (!info) return [];
    const R = norm(info.rotate + entry.rot);
    const out = [];
    for (const f of src.fields) {
      if (f.readOnly) continue;
      for (const w of f.widgets) {
        if (w.page !== entry.page) continue;
        out.push(fieldNode(f, w, `${entry.src}|${f.name}`, widgetBox(w.rect, R, info.crop), m));
      }
    }
    return out;
  }

  function formPanel(body) {
    const S = ctx.S;
    const all = ctx.sources.all().filter((s) => s.fields.length).flatMap((s) => s.fields.map((f) => ({ s, f })));
    const fillable = all.filter((x) => !x.f.readOnly);
    const kept = ctx.kept();
    const first = kept[0] && kept[0].src;
    const whole = !!first && kept.every((e) => e.src === first) && new Set(kept.map((e) => e.page)).size === ctx.sources.get(first).count;
    body.append(
      group(t('Form fields'),
        el('p', { class: 'gs-hint', text: tn(fillable.length, '{n} field to fill in.', '{n} fields to fill in.') + ' ' + t('Click a field on the page and type, tick or choose.') }),
        el('label', { class: 'gs-check' }, [
          el('input', { type: 'checkbox', checked: S.form.flatten || !whole, disabled: !whole, onchange: (e) => ctx.commit((st) => { st.form.flatten = e.target.checked; }, { keepPanel: false }) }),
          t('Make what you filled in part of the page'),
        ]),
        el('p', { class: 'gs-hint', text: whole
          ? (S.form.flatten ? t('The fields are gone from the saved file: what you typed is printed on the page and cannot be changed.') : t('The saved file is still a form: the fields keep what you typed and can be changed.'))
          : t('Pages that were left out or joined from several files always take what you typed into the page itself.') }),
      ),
      group(t('Your entries'),
        (entriesUi.note = el('p', { class: 'gs-hint', role: 'status' })),
        (entriesUi.clear = button(icon('trash'), t('Clear all entries'), () => ctx.commit((st) => { st.form.values = {}; }))),
        el('p', { class: 'gs-hint', text: t('Letters the PDF’s standard fonts do not have, such as Greek or Chinese, would turn into “?”. German, French and other Western European text is fine.') }),
      ),
    );
    showEntries();
  }

  const DPI_CHOICES = [[100, 'Smaller'], [150, 'Balanced'], [200, 'Sharper']];
  function finishPanel(body) {
    const S = ctx.S, fin = S.finish, pr = fin.protect;
    const set = (patch, coalesce) => ctx.commit((st) => Object.assign(st.finish, patch), { coalesce });
    // typing in a password box changes the state without redrawing the panel, or the box would lose the keyboard
    const setPr = (patch, coalesce, typing = false) => ctx.commit((st) => Object.assign(st.finish.protect, patch), { coalesce, keepPanel: typing, quiet: typing });
    const covered = ctx.kept().filter((e) => (S.marks.get(e.id) || []).some((x) => x.type === 'rect')).length;
    const total = ctx.kept().length;
    const modes = [['none', t('As they are')], ['covered', t('Pages with a cover-up')], ['all', t('Every page')]];
    const modeNote = {
      none: covered ? tn(covered, '{n} page has a cover-up. It hides what is under it from view and print, but the text is still in the file and can be copied.', '{n} pages have a cover-up. It hides what is under it from view and print, but the text is still in the file and can be copied.')
        : t('Pages stay as text and graphics.'),
      covered: covered ? tn(covered, '{n} page with a cover-up is drawn again as a picture, so what was under the cover is gone for good. Its text can no longer be selected or searched.', '{n} pages with a cover-up are drawn again as pictures, so what was under the covers is gone for good. Their text can no longer be selected or searched.')
        : t('No page has a cover-up yet. Use “Cover up” in Fill and sign, then come back.'),
      all: tn(total, 'The page becomes a picture. It gets smaller if it was a scan, and its text can no longer be selected or searched.', 'All {n} pages become pictures. They get smaller if they were scans, and their text can no longer be selected or searched.'),
    }[fin.pictures];
    const why = () => (!pr.on ? '' : !pr.password ? t('Type a password, or untick the box.') : pr.password !== pr.repeat ? t('The two passwords are not the same.') : '');
    const mark = el('p', { class: 'gs-warn', role: 'status', hidden: !why(), text: why() });
    const sync = () => { mark.textContent = why(); mark.hidden = !mark.textContent; };
    body.append(
      group(t('Turn pages into pictures'),
        chips(modes, fin.pictures, (id) => set({ pictures: id }), { label: t('Pages') }),
        el('p', { class: 'gs-hint', text: modeNote }),
        ...(fin.pictures !== 'none' ? [chips(DPI_CHOICES.map(([d, label]) => [d, t(label)]), fin.dpi, (d) => set({ dpi: d }), { label: t('Sharpness') }),
          el('p', { class: 'gs-hint', text: t('Sharper pictures look better and make a larger file.') })] : []),
        ...(fin.pictures === 'none' && covered ? [button(null, t('Use pages with a cover-up'), () => set({ pictures: 'covered' }))] : []),
      ),
      group(t('Password'),
        el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: pr.on, onchange: (e) => setPr({ on: e.target.checked }) }), t('Ask for a password to open the file')]),
        ...(pr.on ? [
          el('label', { class: 'gs-field' }, [el('span', { class: 'gs-label', text: t('Password') }),
            el('input', { class: 'gs-input', type: 'password', autocomplete: 'new-password', value: pr.password, oninput: (e) => { setPr({ password: e.target.value }, 'pw', true); sync(); } })]),
          el('label', { class: 'gs-field' }, [el('span', { class: 'gs-label', text: t('Once more') }),
            el('input', { class: 'gs-input', type: 'password', autocomplete: 'new-password', value: pr.repeat, oninput: (e) => { setPr({ repeat: e.target.value }, 'pw2', true); sync(); } })]),
          mark,
          el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: pr.print, onchange: (e) => setPr({ print: e.target.checked }) }), t('Allow printing')]),
          el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: pr.copy, onchange: (e) => setPr({ copy: e.target.checked }) }), t('Allow copying text and pictures')]),
          el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: pr.edit, onchange: (e) => setPr({ edit: e.target.checked }) }), t('Allow changing the file')]),
          el('p', { class: 'gs-hint', text: t('Nothing keeps the password: if it is forgotten, the file cannot be opened. The three “allow” choices are respected by most PDF programs, but not by all; only the password itself is a lock.') }),
        ] : []),
      ),
      el('p', { class: 'gs-hint', text: t('These choices apply to the file you save and to every file you split off.') }),
    );
  }

  // ---- what the editor calls ----
  const view = {
    stage,
    renderPanel(body) { ({ mark: markPanel, number: numberPanel, form: formPanel, finish: finishPanel })[mode](body); },
    refresh() { widthNow = sheetWidth(); build(); },
    activate() { stage.dataset.tool = tool; requestAnimationFrame(() => { this.refresh(); stage.scrollTop = 0; }); },
    deactivate() { io.disconnect(); queue.length = 0; rebuildKey = ''; clear(sheets); live.clear(); },
    zoom(delta) { zoom = Math.min(2.5, Math.max(0.5, delta === 0 ? 1 : zoom + delta)); rebuildKey = ''; this.refresh(); return Math.round(zoom * 100); },
    zoomLevel: () => Math.round(zoom * 100),
    key(e) {
      if (mode !== 'mark' || !sel) return false;
      if (e.key === 'Delete' || e.key === 'Backspace') { remove(sel.page, sel.id); return true; }
      if (e.key === 'Escape') { select(null, null); return true; }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        const m = metrics(entryOf(sel.page)), mk = selMark();
        if (mk) ctx.commit((S) => setMark(sel.page, shifted(mk, d[0] * m.k / m.w, d[1] * m.k / m.h)), { coalesce: 'nudge' });
        return true;
      }
      return false;
    },
    setTool,
    get tool() { return tool; },
  };
  new ResizeObserver(() => { if (stage.isConnected && Math.abs(sheetWidth() - widthNow) > 4 && stage.clientWidth > 0) view.refresh(); }).observe(stage);
  return view;
}
