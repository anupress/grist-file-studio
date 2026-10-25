// The picture editor: crop, rotate, straighten, light and colour, mark-up, hiding, size and format.
//
// Nothing is applied to the picture until it is saved. The editor keeps a small description of the
// edits (state below) and draws it: on screen at screen size, at full size when saving. Each step of
// the drawing is kept (the turned picture, its crop, the pixels before adjusting) so that moving a
// slider only redoes the steps after it. Marks and hidden areas are stored in the coordinates of the
// turned picture, so a later crop leaves them on the things they point at.
//
// Saving: as the same file (it takes the original's place in its cell), as a copy next to it, or only
// to the computer (for people who may not change the document). Canvas re-encoding drops the camera's
// data, location included: the Size tab says so.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { trapFocus, openMenu, confirmBox, textBox } from '../ui/dialog.js';
import {
  ADJUST_DEFAULTS, LOOKS, isIdentity, applyAdjust, autoLevels, pixelate, turnedSize, straightenScale,
  cropToAspect, dragCrop, resizeTo, outputFormat,
} from '../media/imaging.js';
import { baseOf } from '../model/kinds.js';
import { t } from '../i18n/index.js';

const MAX_PIXELS = 40e6;
const PREVIEW_MAX = 1800;
const COLOURS = [{ id: 'red', hex: '#e5484d' }, { id: 'yellow', hex: '#f5c400' }, { id: 'blue', hex: '#2f7de1' }, { id: 'white', hex: '#ffffff' }, { id: 'black', hex: '#111111' }];
const COLOUR_LABELS = { red: 'Red', yellow: 'Yellow', blue: 'Blue', white: 'White', black: 'Black' };
const FORMAT_NAMES = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' };
const SIZES = { s: 0.0035, m: 0.006, l: 0.011 };
const ASPECTS = [['free', 'Free', null], ['orig', 'Original', 'orig'], ['1:1', '1:1', 1], ['4:3', '4:3', 4 / 3], ['3:2', '3:2', 3 / 2], ['16:9', '16:9', 16 / 9]];
const SLIDERS = [['exposure', -2, 2, 0.05], ['contrast', -100, 100, 1], ['highlights', -100, 100, 1], ['shadows', -100, 100, 1], ['saturation', -100, 100, 1], ['warmth', -100, 100, 1], ['sharpness', 0, 100, 1]];
const SLIDER_LABELS = { exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', saturation: 'Saturation', warmth: 'Warmth', sharpness: 'Sharpness' };
const LOOK_LABELS = { none: 'None', doc: 'Document', docColour: 'Document, colour', bw: 'Black & white', warm: 'Warm', cool: 'Cool', vivid: 'Vivid', soft: 'Soft' };
const TAB_LABELS = { crop: 'Crop', adjust: 'Adjust', mark: 'Mark up', hide: 'Hide', size: 'Size' };

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const fresh = () => ({ rot: 0, flipH: false, flipV: false, straighten: 0, crop: null, aspect: 'free', portrait: false, adj: { ...ADJUST_DEFAULTS }, look: 'none', marks: [], hides: [], out: { width: null, format: 'same', quality: 0.9 } });

/**
 * @param o {file, source, canSave, canCopy, onSave(blob, {mode: 'replace'|'copy'|'download', name, pause(on)}) -> Promise<bool>}
 *   pause(true) hides the Saving… note while the save asks a question first.
 */
export async function openImageEditor(host, o) {
  const f = o.file;
  const root = el('div', { class: 'gs-lightbox gs-ed', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Edit {name}', { name: f.name }), tabindex: '-1' });
  const wait = el('div', { class: 'gs-ed__wait', role: 'status' }, [t('Opening the picture…')]);
  root.append(wait);
  host.append(root);
  let bmp;
  try {
    const blob = await o.source.blob(f);
    bmp = await createImageBitmap(blob);
  } catch {
    wait.textContent = t('This browser cannot open this picture for editing.');
    setTimeout(() => root.remove(), 2500);
    return;
  }
  if (bmp.width * bmp.height > MAX_PIXELS) {
    wait.textContent = t('This picture is too large to edit here (over 40 megapixels).');
    setTimeout(() => root.remove(), 3000);
    return;
  }
  const W = bmp.width, H = bmp.height;
  root.removeChild(wait);

  // ---- state and history ----
  let st = fresh();
  const past = [], future = [];
  let dirty = false;
  const snap = () => JSON.stringify(st);
  function commit(before) {
    if (before === snap()) return;
    past.push(before); future.length = 0; dirty = true;
    syncButtons();
    // The mark and hide panels' Remove buttons depend on what is drawn; the sliders' panels redraw
    // themselves as they move.
    if (tab === 'mark' || tab === 'hide') renderPanel();
  }
  function change(fn) { const before = snap(); fn(); commit(before); draw(); }
  function undo() { if (!past.length) return; future.push(snap()); st = JSON.parse(past.pop()); dirty = true; invalidate(); renderPanel(); draw(); syncButtons(); }
  function redo() { if (!future.length) return; past.push(snap()); st = JSON.parse(future.pop()); invalidate(); renderPanel(); draw(); syncButtons(); }

  // ---- drawing, step by step, with each step kept ----
  const pScale = Math.min(1, PREVIEW_MAX / Math.max(W, H));
  let cache = { geomKey: '', geom: null, baseKey: '', base: null };
  const invalidate = () => { cache = { geomKey: '', geom: null, baseKey: '', base: null }; };
  const geomKey = () => `${st.rot}|${st.flipH}|${st.flipV}|${st.straighten}`;
  const turned = () => turnedSize(W, H, st.rot);
  function geometry(scale) {
    const [tw, th] = turned();
    const c = canvas(tw * scale, th * scale);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.translate(c.width / 2, c.height / 2);
    x.rotate(((st.rot + st.straighten) * Math.PI) / 180);
    x.scale(st.flipH ? -1 : 1, st.flipV ? -1 : 1);
    const k = straightenScale(tw, th, st.straighten);
    x.scale(k, k);
    x.drawImage(bmp, (-W * scale) / 2, (-H * scale) / 2, W * scale, H * scale);
    return c;
  }
  const cropOf = () => st.crop || { x: 0, y: 0, w: 1, h: 1 };
  function cropped(geom) {
    const c = cropOf();
    const out = canvas(c.w * geom.width, c.h * geom.height);
    out.getContext('2d').drawImage(geom, c.x * geom.width, c.y * geom.height, c.w * geom.width, c.h * geom.height, 0, 0, out.width, out.height);
    return out;
  }
  /** Map a rectangle or point of the turned picture (fractions) onto the cropped output (pixels). */
  const toOut = (out, gx, gy) => { const c = cropOf(); return [((gx - c.x) / c.w) * out.width, ((gy - c.y) / c.h) * out.height]; };
  function finish(out, { adjust = true, hides = true, marks = true } = {}) {
    const ctx = out.getContext('2d');
    if (adjust && !isIdentity(st.adj)) {
      const img = ctx.getImageData(0, 0, out.width, out.height);
      applyAdjust(img, { ...st.adj, sharpness: st.adj.sharpness * Math.min(1, out.width / 1200 + 0.3) });
      ctx.putImageData(img, 0, 0);
    }
    if (hides) for (const h of st.hides) hideArea(out, h);
    if (marks) for (const m of st.marks) drawMark(ctx, out, m);
    return out;
  }
  function hideArea(out, h) {
    const ctx = out.getContext('2d');
    const [x0, y0] = toOut(out, h.x, h.y);
    const [x1, y1] = toOut(out, h.x + h.w, h.y + h.h);
    const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    if (r.w < 1 || r.h < 1) return;
    if (h.type === 'box') { ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h); return; }
    if (h.type === 'pixelate') {
      const img = ctx.getImageData(0, 0, out.width, out.height);
      pixelate(img, r, Math.max(6, out.width / 70));
      ctx.putImageData(img, 0, 0);
      return;
    }
    // blur: a copy of the area drawn back through a blur filter, clipped to the area
    const pad = Math.ceil(out.width / 40);
    const tmp = canvas(r.w + pad * 2, r.h + pad * 2);
    tmp.getContext('2d').drawImage(out, r.x - pad, r.y - pad, tmp.width, tmp.height, 0, 0, tmp.width, tmp.height);
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.filter = `blur(${Math.max(4, out.width / 90)}px)`;
    ctx.drawImage(tmp, r.x - pad, r.y - pad);
    ctx.drawImage(tmp, r.x - pad, r.y - pad);
    ctx.restore();
  }
  function drawMark(ctx, out, m) {
    const lw = Math.max(2, out.width * (SIZES[m.size] || SIZES.m));
    const pts = m.points.map(([gx, gy]) => toOut(out, gx, gy));
    ctx.save();
    ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // A thin dark edge keeps a yellow or white mark readable on a light wall.
    ctx.shadowColor = m.color === '#111111' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = lw * 0.8;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (m.type === 'pen') { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
    else if (m.type === 'rect') ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    else if (m.type === 'ellipse') { ctx.beginPath(); ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (m.type === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = lw * 4.5;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0] - Math.cos(ang) * head * 0.6, b[1] - Math.sin(ang) * head * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45));
      ctx.lineTo(b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
    } else if (m.type === 'text') {
      const fs = Math.max(12, out.width * (SIZES[m.size] || SIZES.m) * 7);
      ctx.font = `600 ${fs}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.shadowBlur = 0;
      ctx.lineWidth = fs / 7; ctx.strokeStyle = m.color === '#111111' || m.color === '#2f7de1' ? '#ffffff' : '#000000';
      ctx.strokeText(m.text, a[0], a[1]);
      ctx.fillText(m.text, a[0], a[1]);
    }
    ctx.restore();
  }

  /** What the screen shows now: the whole turned picture while cropping, the result otherwise. */
  function preview() {
    if (cache.geomKey !== geomKey()) { cache.geom = geometry(pScale); cache.geomKey = geomKey(); cache.baseKey = ''; }
    if (tab === 'crop') return finish(copyOf(cache.geom), { hides: false, marks: false });
    const key = cache.geomKey + '|' + JSON.stringify(cropOf());
    if (cache.baseKey !== key) { cache.base = cropped(cache.geom); cache.baseKey = key; }
    return finish(copyOf(cache.base));
  }
  const copyOf = (c) => { const d = canvas(c.width, c.height); d.getContext('2d').drawImage(c, 0, 0); return d; };

  // ---- the page ----
  const name = el('span', { class: 'gs-lb__name', text: f.name });
  const undoBtn = barBtn('undo', t('Undo (Ctrl+Z)'), () => undo());
  const redoBtn = barBtn('redo', t('Redo (Ctrl+Y)'), () => redo());
  const compare = barBtn('eye', t('Hold to compare with the original'), null);
  const saveBtn = el('button', { type: 'button', class: 'gs-btn gs-btn--primary gs-ed__save', 'aria-haspopup': 'menu', onclick: () => saveMenu() }, [t('Save'), icon('chevron')]);
  const bar = el('div', { class: 'gs-lb__bar' }, [
    barBtn('close', t('Close without saving (Esc)'), () => close()),
    el('span', { class: 'gs-ed__title' }, [t('Editing'), ' ', name]),
    el('div', { class: 'gs-lb__tools' }, [undoBtn, redoBtn, compare, el('span', { class: 'gs-lb__sep' }), saveBtn]),
  ]);
  const view = el('canvas', { class: 'gs-ed__canvas' });
  const stageEl = el('div', { class: 'gs-ed__stage' }, [view]);
  const tabs = el('div', { class: 'gs-ed__tabs', role: 'tablist' });
  const panelBody = el('div', { class: 'gs-ed__panel-body' });
  const panel = el('aside', { class: 'gs-ed__panel' }, [tabs, panelBody]);
  root.append(bar, el('div', { class: 'gs-ed__body' }, [stageEl, panel]));
  const release = trapFocus(root, () => close());
  root.focus({ preventScroll: true });

  function barBtn(ic, label, onclick) { return el('button', { type: 'button', class: 'gs-lb__btn', title: label, 'aria-label': label, onclick }, [icon(ic)]); }
  function syncButtons() { undoBtn.disabled = !past.length; redoBtn.disabled = !future.length; }

  // ---- the canvas on screen ----
  let disp = { x: 0, y: 0, w: 1, h: 1 }, shown = null, comparing = false, raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
  function paint() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = stageEl.clientWidth, bh = stageEl.clientHeight;
    view.width = Math.round(bw * dpr); view.height = Math.round(bh * dpr);
    view.style.width = bw + 'px'; view.style.height = bh + 'px';
    const ctx = view.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    shown = comparing ? original() : preview();
    const pad = 24;
    const s = Math.min((bw - pad * 2) / shown.width, (bh - pad * 2) / shown.height);
    disp = { w: shown.width * s, h: shown.height * s, x: (bw - shown.width * s) / 2, y: (bh - shown.height * s) / 2 };
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(shown, disp.x, disp.y, disp.w, disp.h);
    if (tab === 'crop' && !comparing) drawCropFrame(ctx);
    if (draft && !comparing) drawDraft(ctx);
  }
  const original = () => { const c = canvas(W * pScale, H * pScale); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return c; };
  function drawCropFrame(ctx) {
    const c = cropOf();
    const r = { x: disp.x + c.x * disp.w, y: disp.y + c.y * disp.h, w: c.w * disp.w, h: c.h * disp.h };
    ctx.save();
    ctx.fillStyle = 'rgba(8, 12, 16, 0.62)';
    ctx.beginPath(); ctx.rect(disp.x, disp.y, disp.w, disp.h); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill('evenodd');
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    for (let k = 1; k < 3; k++) {   // thirds, for placing the subject
      ctx.beginPath(); ctx.moveTo(r.x + (r.w * k) / 3, r.y); ctx.lineTo(r.x + (r.w * k) / 3, r.y + r.h);
      ctx.moveTo(r.x, r.y + (r.h * k) / 3); ctx.lineTo(r.x + r.w, r.y + (r.h * k) / 3); ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    for (const [hx, hy] of handlePoints(r)) ctx.fillRect(hx - 5, hy - 5, 10, 10);
    ctx.restore();
  }
  const handlePoints = (r) => [[r.x, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h / 2], [r.x + r.w, r.y + r.h], [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h / 2]];
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  // ---- pointer: crop handles, drawing marks, hiding areas ----
  let draft = null, drag = null;
  const local = (e) => { const b = view.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  /** A screen point -> fractions of the turned picture. */
  const toGeom = ([sx, sy]) => { const c = cropOf(); const u = (sx - disp.x) / disp.w, v = (sy - disp.y) / disp.h; return tab === 'crop' ? [u, v] : [c.x + u * c.w, c.y + v * c.h]; };
  view.addEventListener('pointerdown', (e) => {
    if (comparing) return;
    const p = local(e);
    if (tab === 'crop') {
      const c = cropOf();
      const r = { x: disp.x + c.x * disp.w, y: disp.y + c.y * disp.h, w: c.w * disp.w, h: c.h * disp.h };
      const hit = handlePoints(r).findIndex(([hx, hy]) => Math.abs(hx - p[0]) < 14 && Math.abs(hy - p[1]) < 14);
      const inside = p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h;
      if (hit < 0 && !inside) return;
      drag = { handle: hit >= 0 ? HANDLES[hit] : 'move', start: p, from: { ...c }, before: snap() };
    } else if (tab === 'mark') {
      const g = toGeom(p);
      if (tool === 'text') { addText(g); return; }
      draft = { type: tool, color, size, points: [g, g] };
    } else if (tab === 'hide') {
      draft = { hide: true, type: hideType, a: toGeom(p), b: toGeom(p) };
    } else return;
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (drag) {
      const [tw, th] = turned();
      const asp = aspectValue();
      st.crop = dragCrop(drag.from, drag.handle, (p[0] - drag.start[0]) / disp.w, (p[1] - drag.start[1]) / disp.h, { aspect: asp, picW: tw, picH: th });
      draw();
    } else if (draft) {
      const g = toGeom(p);
      if (draft.hide) draft.b = g;
      else if (draft.type === 'pen') draft.points.push(g);
      else draft.points[1] = g;
      draw();
    } else if (tab === 'crop') {
      view.style.cursor = cropCursor(p);
    }
  });
  const up = () => {
    if (drag) { const before = drag.before; drag = null; commit(before); draw(); return; }
    if (!draft) return;
    const d = draft; draft = null;
    if (d.hide) {
      const r = { type: d.type, x: Math.min(d.a[0], d.b[0]), y: Math.min(d.a[1], d.b[1]), w: Math.abs(d.b[0] - d.a[0]), h: Math.abs(d.b[1] - d.a[1]) };
      if (r.w > 0.005 && r.h > 0.005) change(() => st.hides.push(r)); else draw();
    } else {
      const [a, b] = [d.points[0], d.points[d.points.length - 1]];
      if (d.type === 'pen' ? d.points.length > 2 : Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) change(() => st.marks.push({ type: d.type, color: d.color, size: d.size, points: d.type === 'pen' ? d.points : [a, b] }));
      else draw();
    }
  };
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  function cropCursor(p) {
    const c = cropOf();
    const r = { x: disp.x + c.x * disp.w, y: disp.y + c.y * disp.h, w: c.w * disp.w, h: c.h * disp.h };
    const hit = handlePoints(r).findIndex(([hx, hy]) => Math.abs(hx - p[0]) < 14 && Math.abs(hy - p[1]) < 14);
    if (hit >= 0) return ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' })[HANDLES[hit]];
    return p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h ? 'move' : 'default';
  }
  function drawDraft(ctx) {
    // Drawn straight onto the screen canvas, in screen coordinates, until it is let go.
    const out = { width: disp.w, height: disp.h };
    ctx.save(); ctx.translate(disp.x, disp.y);
    if (draft.hide) {
      const [x0, y0] = toOut(out, draft.a[0], draft.a[1]), [x1, y1] = toOut(out, draft.b[0], draft.b[1]);
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else drawMark(ctx, out, draft);
    ctx.restore();
  }
  async function addText(g) {
    const text = await textBox(root, { title: t('Add text'), label: t('Text'), value: '', ok: t('Add') });
    if (text) change(() => st.marks.push({ type: 'text', color, size, points: [g], text }));
  }
  compare.addEventListener('pointerdown', () => { comparing = true; compare.classList.add('is-on'); draw(); });
  const stopCompare = () => { if (comparing) { comparing = false; compare.classList.remove('is-on'); draw(); } };
  compare.addEventListener('pointerup', stopCompare);
  compare.addEventListener('pointerleave', stopCompare);
  const ro = new ResizeObserver(() => draw());
  ro.observe(stageEl);

  // ---- the panel ----
  let tab = 'crop', tool = 'arrow', color = COLOURS[0].hex, size = 'm', hideType = 'blur';
  const aspectValue = () => {
    const a = ASPECTS.find((x) => x[0] === st.aspect)?.[2] ?? null;
    if (a === 'orig') { const [tw, th] = turned(); return tw / th; }   // the picture's own shape, as it is turned
    if (!a) return null;
    return st.portrait ? 1 / a : a;
  };
  function renderTabs() {
    clear(tabs).append(...Object.entries(TAB_LABELS).map(([id, label]) => el('button', {
      type: 'button', role: 'tab', class: 'gs-ed__tab' + (tab === id ? ' is-on' : ''), 'aria-selected': tab === id ? 'true' : 'false',
      text: t(label), onclick: () => { tab = id; renderTabs(); renderPanel(); draw(); },
    })));
  }
  const group = (label, ...kids) => el('div', { class: 'gs-ed__group' }, [label ? el('div', { class: 'gs-ed__label', text: label }) : null, ...kids]);
  const chips = (items, current, pick) => el('div', { class: 'gs-ed__chips' }, items.map(([id, label]) => el('button', {
    type: 'button', class: 'gs-chip' + (id === current ? ' is-on' : ''), 'aria-pressed': id === current ? 'true' : 'false', text: label, onclick: () => pick(id),
  })));
  const button = (ic, label, onclick, extra = {}) => el('button', { type: 'button', class: 'gs-btn', onclick, ...extra }, [ic ? icon(ic) : null, label]);
  function slider(key, label, min, max, step, value, onInput, format = (v) => String(v)) {
    const out = el('span', { class: 'gs-ed__value', text: format(value) });
    const rest = min < 0 ? 0 : min;
    let before = null;
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label,
      onpointerdown: () => { before = snap(); }, onkeydown: () => { before ??= snap(); },
      oninput: () => { onInput(Number(input.value)); out.textContent = format(Number(input.value)); mark(); draw(); },
      onchange: () => { commit(before ?? snap()); before = null; } });
    // Double-click the name to put it back to zero.
    const name = el('label', { class: 'gs-ed__slider-name', text: label, title: t('Double-click to reset'), ondblclick: () => { const b = snap(); onInput(rest); input.value = String(rest); out.textContent = format(rest); mark(); commit(b); draw(); } });
    // A slider away from its resting point gets the accent thumb and number, so a glance down the
    // panel shows which ones are doing something.
    const box = el('div', { class: 'gs-ed__slider' }, [name, out, input]);
    const mark = () => box.classList.toggle('is-changed', Number(input.value) !== rest);
    mark();
    return box;
  }
  function renderPanel() {
    clear(panelBody);
    if (tab === 'crop') {
      const [tw, th] = turned();
      const setAspect = (id) => change(() => { st.aspect = id; st.crop = cropToAspect(cropOf(), aspectValue(), tw, th); });
      panelBody.append(
        group(t('Shape'), chips(ASPECTS.map(([id, label]) => [id, id === 'free' ? t('Free') : id === 'orig' ? t('Original') : label]), st.aspect, (id) => { setAspect(id); renderPanel(); }),
          el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: st.portrait, onchange: (e) => { st.portrait = e.target.checked; setAspect(st.aspect); renderPanel(); } }), t('Upright (portrait)')])),
        group(t('Turn'), el('div', { class: 'gs-ed__row' }, [
          button('undo', t('Left'), () => change(() => { st.rot = (st.rot + 270) % 360; st.crop = null; st.aspect = 'free'; })),
          button('redo', t('Right'), () => change(() => { st.rot = (st.rot + 90) % 360; st.crop = null; st.aspect = 'free'; })),
          button('swap', t('Flip'), () => change(() => { st.flipH = !st.flipH; })),
          button('swap', t('Flip upside down'), () => change(() => { st.flipV = !st.flipV; }), { class: 'gs-btn gs-ed__flipv' }),
        ])),
        group(null, slider('straighten', t('Straighten'), -45, 45, 0.5, st.straighten, (v) => { st.straighten = v; }, (v) => `${v > 0 ? '+' : ''}${v}°`)),
        el('div', { class: 'gs-ed__row' }, [button(null, t('Reset crop and turn'), () => change(() => { st.crop = null; st.rot = 0; st.flipH = st.flipV = false; st.straighten = 0; st.aspect = 'free'; renderPanel(); }))]),
      );
    } else if (tab === 'adjust') {
      panelBody.append(
        el('div', { class: 'gs-ed__row' }, [
          button('sparkles', t('Auto'), () => change(() => {
            const base = cache.base || cropped(cache.geom || geometry(pScale));
            st.adj.levels = autoLevels(base.getContext('2d').getImageData(0, 0, base.width, base.height));
            if (!st.adj.levels) toastIn(t('The picture already uses the full range: Auto changes nothing.'));
          }), { class: 'gs-btn' + (st.adj.levels ? ' is-on' : ''), title: t('Stretch the light and take out a colour cast') }),
          button(null, t('Reset'), () => change(() => { st.adj = { ...ADJUST_DEFAULTS }; st.look = 'none'; renderPanel(); })),
        ]),
        group(t('Look'), chips(Object.keys(LOOKS).map((id) => [id, t(LOOK_LABELS[id])]), st.look, (id) => {
          change(() => { st.look = id; st.adj = { ...ADJUST_DEFAULTS, levels: st.adj.levels, ...LOOKS[id] }; });
          renderPanel();
        })),
        ...SLIDERS.map(([key, min, max, step]) => slider(key, t(SLIDER_LABELS[key]), min, max, step, st.adj[key], (v) => { st.adj[key] = v; },
          key === 'exposure' ? (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}` : (v) => `${v > 0 ? '+' : ''}${v}`)),
      );
    } else if (tab === 'mark') {
      panelBody.append(
        group(t('Draw'), chips([['arrow', t('Arrow')], ['rect', t('Box')], ['ellipse', t('Circle')], ['pen', t('Pen')], ['text', t('Text')]], tool, (id) => { tool = id; renderPanel(); })),
        group(t('Colour'), el('div', { class: 'gs-ed__swatches', role: 'radiogroup', 'aria-label': t('Colour') }, COLOURS.map(({ id, hex }) => el('button', {
          type: 'button', role: 'radio', class: 'gs-ed__swatch' + (hex === color ? ' is-on' : ''), 'aria-checked': hex === color ? 'true' : 'false',
          'aria-label': t(COLOUR_LABELS[id]), title: t(COLOUR_LABELS[id]), style: { '--sw': hex }, onclick: () => { color = hex; renderPanel(); },
        })))),
        group(t('Line'), chips([['s', t('Thin')], ['m', t('Medium')], ['l', t('Thick')]], size, (id) => { size = id; renderPanel(); })),
        el('p', { class: 'gs-hint', text: tool === 'text' ? t('Click the picture where the text should go.') : t('Drag on the picture to draw.') }),
        el('div', { class: 'gs-ed__row' }, [
          button(null, t('Remove the last mark'), () => change(() => { st.marks.pop(); }), { disabled: !st.marks.length }),
          button(null, t('Remove all marks'), () => change(() => { st.marks = []; renderPanel(); }), { disabled: !st.marks.length }),
        ]),
      );
    } else if (tab === 'hide') {
      panelBody.append(
        el('p', { class: 'gs-hint', text: t('Drag over faces, number plates or names to hide them before the picture is shared.') }),
        group(t('How'), chips([['blur', t('Blur')], ['pixelate', t('Pixelate')], ['box', t('Black box')]], hideType, (id) => { hideType = id; renderPanel(); })),
        el('div', { class: 'gs-ed__row' }, [
          button(null, t('Remove the last one'), () => change(() => { st.hides.pop(); }), { disabled: !st.hides.length }),
          button(null, t('Remove all'), () => change(() => { st.hides = []; renderPanel(); }), { disabled: !st.hides.length }),
        ]),
      );
    } else if (tab === 'size') {
      const [cw, ch] = croppedSize();
      const [ow, oh] = st.out.width ? resizeTo(cw, ch, { width: st.out.width }) : [cw, ch];
      const [mime, ext] = outputFormat(st.out.format, f.ext);
      const widthIn = el('input', { type: 'number', class: 'gs-input gs-ed__num', min: '16', max: String(cw), value: String(ow), 'aria-label': t('Width'),
        onchange: () => change(() => { const v = Math.min(cw, Math.max(16, Number(widthIn.value) || cw)); st.out.width = v >= cw ? null : v; renderPanel(); }) });
      const heightIn = el('input', { type: 'number', class: 'gs-input gs-ed__num', min: '16', max: String(ch), value: String(oh), 'aria-label': t('Height'),
        onchange: () => change(() => { const v = Math.min(ch, Math.max(16, Number(heightIn.value) || ch)); const [w2] = resizeTo(cw, ch, { height: v }); st.out.width = w2 >= cw ? null : w2; renderPanel(); }) });
      panelBody.append(
        group(t('Size in pixels'), el('div', { class: 'gs-ed__row gs-ed__dims' }, [widthIn, el('span', { text: '×' }), heightIn]),
          chips([[100, '100 %'], [75, '75 %'], [50, '50 %'], [25, '25 %']].map(([p, l]) => [String(p), l]), st.out.width ? String(Math.round((st.out.width / cw) * 100)) : '100',
            (p) => change(() => { st.out.width = p === '100' ? null : resizeTo(cw, ch, { percent: Number(p) })[0]; renderPanel(); }))),
        group(t('Format'), el('select', { class: 'gs-input', 'aria-label': t('Format'), onchange: (e) => change(() => { st.out.format = e.target.value; renderPanel(); }) },
          [['same', t('Like the original')], ...Object.entries(FORMAT_NAMES)].map(([v, l]) => el('option', { value: v, text: l, selected: st.out.format === v })))),
        mime !== 'image/png' ? slider('quality', t('Quality'), 60, 100, 1, Math.round(st.out.quality * 100), (v) => { st.out.quality = v / 100; }, (v) => `${v} %`) : null,
        el('p', { class: 'gs-hint', text: t('Saves as {w} × {h} px, {format}.', { w: ow, h: oh, format: ext.toUpperCase() }) }),
        el('p', { class: 'gs-hint', text: t('Saving writes a new picture: the camera’s data, including where the photo was taken, is not kept.') }),
      );
    }
  }
  const croppedSize = () => { const [tw, th] = turned(); const c = cropOf(); return [Math.round(c.w * tw), Math.round(c.h * th)]; };

  let toastTimer = 0;
  const note = el('div', { class: 'gs-media__note', hidden: true });
  stageEl.append(note);
  function toastIn(text) { note.textContent = text; note.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { note.hidden = true; }, 3500); }

  // ---- saving ----
  async function render() {
    const geom = geometry(1);
    const out = finish(cropped(geom));
    if (!st.out.width || st.out.width >= out.width) return out;
    // Down in halves, then the last step: a single big step would alias fine detail.
    let cur = out;
    const [tw, th] = resizeTo(out.width, out.height, { width: st.out.width });
    while (cur.width / 2 > tw) { const half = canvas(cur.width / 2, cur.height / 2); const x = half.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, half.width, half.height); cur = half; }
    const last = canvas(tw, th); const x = last.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, tw, th);
    return last;
  }
  async function save(mode) {
    const [mime, ext] = outputFormat(st.out.format, f.ext);
    const busy = el('div', { class: 'gs-ed__wait', role: 'status' }, [t('Saving…')]);
    root.append(busy);
    try {
      const out = await render();
      const blob = await new Promise((resolve) => out.toBlob(resolve, mime, st.out.quality));
      if (!blob) throw new Error(t('The browser could not write the picture.'));
      const base = baseOf(f.name);
      const fileName = mode === 'copy' ? `${base} (${t('edited')}).${ext}` : `${base}.${ext}`;
      const done = await o.onSave(blob, { mode, name: fileName, pause: (on) => { busy.hidden = on; } });
      busy.remove();
      if (done) { dirty = false; close(true); }
    } catch (e) {
      busy.remove();
      toastIn(t('Not saved: {why}', { why: String(e?.message || e) }));
    }
  }
  function saveMenu() {
    openMenu(root, saveBtn, [
      [t('Save'), () => save('replace'), { disabled: !o.canSave, hint: o.canSave ? t('The edited picture takes the original’s place') : t('You cannot change this file here; save a copy or download it') }],
      [t('Save as copy'), () => save('copy'), { disabled: !o.canCopy, hint: t('Next to the original, which stays as it is') }],
      [t('Download'), () => save('download'), { hint: t('Only to your computer; the document stays as it is') }],
    ]);
  }

  // ---- closing and keys ----
  async function close(force = false) {
    if (!force && dirty) {
      const ok = await confirmBox(root, { title: t('Close without saving?'), body: t('Your edits to this picture will be lost.'), ok: t('Close without saving'), danger: true });
      if (!ok) return;
    }
    ro.disconnect(); release(); bmp.close?.(); root.remove();
  }
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, .gs-dialog, .gs-menu')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key === 'y') { e.preventDefault(); redo(); }
    else if (mod && e.key === 's') { e.preventDefault(); save(o.canSave ? 'replace' : o.canCopy ? 'copy' : 'download'); }
  });

  renderTabs();
  renderPanel();
  syncButtons();
  draw();
}
