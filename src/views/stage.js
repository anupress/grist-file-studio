// One file, large: what the lightbox and the Viewer show.
//
//   Pictures   the full file in an <img>, the thumbnail standing in until it arrives; fit, 100 %, wheel
//              and pinch zoom around the pointer, double-click or double-tap to zoom, drag to pan,
//              rotate the view (the file is never changed); swipe sideways at fit size for the next.
//   PDFs       pdf.js pages drawn as they scroll into view, with zoom; the browser's own viewer is a
//              new tab away (see pdfView for why it is not used here).
//   Video and audio
//              loaded whole as a Blob first, with progress, because Grist does not serve byte ranges
//              and a streamed video cannot seek (M0). Very large files stream instead, and say so.
//   Text       as text, never as HTML: CSV and TSV as a table, JSON pretty-printed.
//   The rest   a card with the type, the size and Download.

import { el, clear, clamp } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { mimeOf, typeLabel, tintOf, sizeText } from '../model/kinds.js';
import { renderPage } from '../media/pdf.js';
import { ALPHA } from './face.js';
import { officeView, OFFICE } from './office.js';
import { t, uiLang } from '../i18n/index.js';
import { shownUrl } from '../media/picture.js';

const MAX_MEDIA_BLOB = 300e6;
const MAX_TEXT = 2e6;

function loading(host, label) {
  const fill = el('div', { class: 'gs-loading__fill is-unknown' });
  const text = el('span', { text: label });
  const box = el('div', { class: 'gs-loading', role: 'status' }, [el('div', { class: 'gs-loading__bar' }, [fill]), text]);
  host.append(box);
  return {
    progress(loaded, total) {
      if (total > 0) { fill.classList.remove('is-unknown'); fill.style.width = Math.round((loaded / total) * 100) + '%'; text.textContent = `${label} ${Math.round((loaded / total) * 100)} %`; }
    },
    remove() { box.remove(); },
  };
}

function fileCard(host, file, { why, onDownload }) {
  host.append(el('div', { class: 'gs-media gs-media--card' }, [el('div', { class: 'gs-media__card' }, [
    el('div', { class: 'gs-paper gs-t-' + tintOf(file.ext) }, [el('span', { class: 'gs-paper__type', text: typeLabel(file.ext) })]),
    el('strong', { text: file.name }),
    el('p', { text: `${typeLabel(file.ext)} · ${sizeText(file.size, uiLang())}` }),
    el('p', { text: why }),
    onDownload ? el('button', { type: 'button', class: 'gs-btn gs-btn--primary', onclick: onDownload }, [icon('download2'), t('Download')]) : null,
  ])]));
}

// ---- pictures ---------------------------------------------------------------------------------------
function pictureView(host, file, { source, thumbs, onZoom, onSwipe, signal }) {
  const box = el('div', { class: 'gs-media', tabindex: '-1' });
  const img = el('img', { class: 'gs-media__img' + (ALPHA.test(file.ext) ? ' gs-alpha' : ''), alt: file.name, draggable: false });
  box.append(img);
  host.append(box);

  const S = { iw: 0, ih: 0, s: 1, cx: 0, cy: 0, rot: 0, fit: 1, fitted: true };
  const W = () => box.clientWidth || 1, H = () => box.clientHeight || 1;
  const rotated = () => S.rot % 180 !== 0;
  const bw = () => (rotated() ? S.ih : S.iw), bh = () => (rotated() ? S.iw : S.ih);
  const minS = () => Math.min(S.fit, 1) * 0.5;
  const maxS = () => Math.max(8, S.fit * 2);

  function apply() {
    // translate(cx, cy) rotate(r) scale(s) translate(-iw/2, -ih/2), with the origin at the top left:
    // the picture's middle lands on (cx, cy) whatever the zoom and turn.
    img.style.transform = `translate(${S.cx}px, ${S.cy}px) rotate(${S.rot}deg) scale(${S.s}) translate(${-S.iw / 2}px, ${-S.ih / 2}px)`;
    img.classList.toggle('is-pixelated', S.s >= 4);
    const zoomed = bw() * S.s > W() + 1 || bh() * S.s > H() + 1;
    box.classList.toggle('is-zoomed', zoomed);
    onZoom?.({ level: S.s, fitted: S.fitted });
  }
  function clampPan() {
    const w = bw() * S.s, h = bh() * S.s;
    S.cx = w <= W() ? W() / 2 : clamp(S.cx, W() - w / 2, w / 2);
    S.cy = h <= H() ? H() / 2 : clamp(S.cy, H() - h / 2, h / 2);
  }
  function fit() {
    if (!S.iw) return;
    // Never blow a small picture up past its own size to fill the screen: it would only get blurry.
    S.fit = Math.min(W() / bw(), H() / bh(), 1);
    S.s = S.fit; S.cx = W() / 2; S.cy = H() / 2; S.fitted = true;
    apply();
  }
  function zoomAt(ns, px = W() / 2, py = H() / 2) {
    ns = clamp(ns, minS(), maxS());
    S.cx = px - (px - S.cx) * (ns / S.s);
    S.cy = py - (py - S.cy) * (ns / S.s);
    S.s = ns; S.fitted = Math.abs(ns - S.fit) < 1e-3;
    clampPan();
    apply();
  }
  function setSize(w, h) { S.iw = w; S.ih = h; img.style.width = w + 'px'; img.style.height = h + 'px'; fit(); }

  // The thumbnail first, stretched to the picture's size, so something is there at once.
  const quick = thumbs?.peek(file, 720) || thumbs?.peek(file, 360);
  if (quick?.url) { img.src = quick.url; if (quick.w && quick.h) setSize(quick.w, quick.h); }
  const wait = quick?.url ? null : loading(box, t('Loading'));
  // A HEIC file is shown as a JPEG made in the browser (media/picture.js); every other picture from its own URL.
  (file.kind === 'heic' ? shownUrl(file, source, { signal }) : source.url(file, { inline: true })).then((url) => {
    if (signal.aborted) return;
    const full = new Image();
    full.decoding = 'async';
    full.onload = () => {
      if (signal.aborted) return;
      wait?.remove();
      const keep = S.iw ? { s: S.s / (full.naturalWidth / S.iw), fitted: S.fitted } : null;
      img.src = full.src;
      S.iw = full.naturalWidth; S.ih = full.naturalHeight;
      img.style.width = S.iw + 'px'; img.style.height = S.ih + 'px';
      if (!keep || keep.fitted) fit(); else { S.fit = Math.min(W() / bw(), H() / bh(), 1); S.s = keep.s; apply(); }
    };
    full.onerror = () => {
      if (signal.aborted) return;
      wait?.remove();
      if (!quick?.url) { box.remove(); fileCard(host, file, { why: t('This browser cannot show this picture. Download it to open it on your computer.') }); }
    };
    full.src = url;
  });

  // ---- pointer: pan, pinch, double-tap, swipe
  const pts = new Map();
  let pan = null, pinch = null, lastTap = 0, swipe = null;
  box.addEventListener('pointerdown', (e) => {
    box.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const b = box.getBoundingClientRect();
    if (pts.size === 2) {
      const [a, c] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - c.x, a.y - c.y), s: S.s, mx: (a.x + c.x) / 2 - b.left, my: (a.y + c.y) / 2 - b.top };
      pan = null; swipe = null;
      return;
    }
    if (box.classList.contains('is-zoomed')) { pan = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy }; box.classList.add('is-panning'); }
    else swipe = { x: e.clientX, y: e.clientY, t: performance.now() };
    const now = performance.now();
    if (e.pointerType !== 'mouse' && now - lastTap < 300) {
      // double tap
      if (S.fitted) zoomAt(Math.max(1, S.fit * 2.5), e.clientX - b.left, e.clientY - b.top); else fit();
      lastTap = 0; swipe = null; pan = null;
    } else lastTap = now;
  });
  box.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, c] = [...pts.values()];
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      zoomAt(pinch.s * (d / pinch.d), pinch.mx, pinch.my);
      return;
    }
    if (pan) { S.cx = pan.cx + (e.clientX - pan.x); S.cy = pan.cy + (e.clientY - pan.y); S.fitted = false; clampPan(); apply(); }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (swipe && pts.size === 0) {
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, dt = performance.now() - swipe.t;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600) onSwipe?.(dx < 0 ? 1 : -1);
    }
    swipe = null;
    if (!pts.size) { pan = null; box.classList.remove('is-panning'); }
  };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  box.addEventListener('dblclick', (e) => {
    const b = box.getBoundingClientRect();
    if (S.fitted) zoomAt(Math.max(1, S.fit * 2.5), e.clientX - b.left, e.clientY - b.top); else fit();
  });
  box.addEventListener('wheel', (e) => {
    e.preventDefault();
    const b = box.getBoundingClientRect();
    // Trackpads send many small steps, a mouse wheel few big ones: zoom by how far it turned.
    const step = Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0025));
    zoomAt(S.s * step, e.clientX - b.left, e.clientY - b.top);
  }, { passive: false });
  const ro = new ResizeObserver(() => { if (S.fitted) fit(); else { clampPan(); apply(); } });
  ro.observe(box);

  return {
    zoomable: true,
    zoomIn: () => zoomAt(S.s * 1.25),
    zoomOut: () => zoomAt(S.s / 1.25),
    fit,
    actual: () => zoomAt(1),
    rotate: (dir = 1) => { S.rot = (S.rot + 90 * dir + 360) % 360; fit(); },
    destroy: () => ro.disconnect(),
  };
}

// ---- PDFs ---------------------------------------------------------------------------------------------
// pdf.js everywhere, not the browser's own viewer: that one is missing on phones and stays blank in
// Electron (Grist Desktop), and inside the lightbox it would swallow the arrow keys. Search and print
// are one click away in a new tab, where the browser's viewer has room.
function pdfView(host, file, { source, signal, onDownload, onZoom, page = 1 }) {
  const pages = el('div', { class: 'gs-media__pages', tabindex: '0', role: 'region', 'aria-label': t('Pages') });
  host.append(pages);
  const wait = loading(host, t('Loading'));
  let doc = null, io = null, ratio = 1.414, pageW = 595, zoom = 1, fitted = true, count = 0;
  const fitWidth = () => Math.min(960, Math.max(200, pages.clientWidth - 32));
  const width = () => Math.round(fitWidth() * zoom);
  function layout() {
    if (!doc) return;
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting || en.target.dataset.drawn === String(width())) continue;
        en.target.dataset.drawn = String(width());
        renderPage(doc, Number(en.target.dataset.n), en.target, width(), { signal }).catch(() => {});
      }
    }, { root: pages, rootMargin: '600px 0px' });
    for (const c of pages.children) {
      c.style.width = width() + 'px';
      c.style.height = Math.round(width() * ratio) + 'px';
      io.observe(c);
    }
    onZoom?.({ level: width() / ((pageW * 96) / 72), fitted });
  }
  function setZoom(z, keepFit = false) {
    const before = pages.scrollTop / Math.max(1, pages.scrollHeight);
    zoom = Math.max(0.3, Math.min(5, z));
    fitted = keepFit;
    layout();
    pages.scrollTop = before * pages.scrollHeight;
  }
  /** Scroll so that page n (1-based) is at the top. */
  function goTo(n) {
    const c = pages.children[Math.max(1, Math.min(count, n)) - 1];
    if (c) pages.scrollTop = c.getBoundingClientRect().top - pages.getBoundingClientRect().top + pages.scrollTop - 8;
  }
  (async () => {
    try {
      const blob = await source.blob(file, { signal, onProgress: (a, b) => wait.progress(a, b) });
      doc = await source.openPdf(blob);
      if (signal.aborted) { doc.destroy(); return; }
      wait.remove();
      const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
      ratio = vp.height / vp.width;
      pageW = vp.width;
      count = doc.numPages;
      for (let n = 1; n <= count; n++) pages.append(el('canvas', { class: 'gs-media__page', dataset: { n: String(n) }, role: 'img', 'aria-label': t('Page {n} of {count}', { n, count }) }));
      layout();
      if (page > 1) goTo(page);
    } catch (e) {
      if (signal.aborted) return;
      wait.remove();
      fileCard(host, file, { why: t('This PDF could not be shown here. Download it to open it on your computer.'), onDownload });
    }
  })();
  const ro = new ResizeObserver(() => { if (doc) layout(); });
  ro.observe(pages);
  pages.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.01)); } }, { passive: false });
  return {
    zoomable: true,
    zoomIn: () => setZoom(zoom * 1.25),
    zoomOut: () => setZoom(zoom / 1.25),
    fit: () => setZoom(1, true),
    actual: () => setZoom(((pageW * 96) / 72) / fitWidth()),
    rotate: null,
    goTo,
    destroy() { ro.disconnect(); io?.disconnect(); doc?.destroy(); },
  };
}

// ---- video and audio -------------------------------------------------------------------------------------
function mediaView(host, file, { source, thumbs, signal, onDownload }) {
  const isVideo = file.kind === 'video';
  const node = el(isVideo ? 'video' : 'audio', { class: isVideo ? 'gs-media__video' : 'gs-media__audio', controls: true, preload: 'auto', playsInline: true });
  const poster = thumbs?.peek(file, 720) || thumbs?.peek(file, 360);
  if (isVideo && poster?.url) node.poster = poster.url;
  const box = el('div', { class: 'gs-media' }, [node]);
  box.style.touchAction = 'auto';
  host.append(box);
  let url = null;
  node.addEventListener('error', () => {
    if (signal.aborted || !node.getAttribute('src')) return;
    box.remove();
    fileCard(host, file, { why: t('This browser cannot play this file. Download it to play it on your computer.'), onDownload });
  });
  if (file.size > MAX_MEDIA_BLOB) {
    source.url(file, { inline: true }).then((u) => { if (!signal.aborted) node.src = u; });
    box.append(el('div', { class: 'gs-media__note', text: t('Large file: it plays from the start, skipping ahead is not possible here.') }));
  } else {
    node.hidden = true;
    const wait = loading(box, isVideo ? t('Loading video') : t('Loading audio'));
    source.blob(file, { type: mimeOf(file.ext), signal, onProgress: (a, b) => wait.progress(a, b) }).then((blob) => {
      if (signal.aborted) return;
      wait.remove();
      url = URL.createObjectURL(blob);
      node.src = url;
      node.hidden = false;
    }).catch(() => {
      if (signal.aborted) return;
      wait.remove();
      fileCard(host, file, { why: t('The file could not be loaded.'), onDownload });
    });
  }
  return { zoomable: false, media: node, destroy() { node.pause?.(); node.removeAttribute('src'); node.load?.(); if (url) URL.revokeObjectURL(url); } };
}

// ---- text ------------------------------------------------------------------------------------------------
/** CSV or TSV -> rows, RFC 4180 quoting. Stops after `max` rows. */
export function parseDelimited(text, sep = ',', max = 2000) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length >= max) return rows;
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function textView(host, file, { source, signal, onDownload }) {
  const wait = loading(host, t('Loading'));
  source.blob(file, { signal }).then(async (blob) => {
    if (signal.aborted) return;
    wait.remove();
    const cut = blob.size > MAX_TEXT;
    let text = await (cut ? blob.slice(0, MAX_TEXT) : blob).text();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (file.ext === 'csv' || file.ext === 'tsv') {
      const sep = file.ext === 'tsv' ? '\t' : (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',');
      const rows = parseDelimited(text, sep);
      const num = /^-?[\d\s.,]+%?$/;
      host.append(el('div', { class: 'gs-media__table' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, (rows[0] || []).map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows.slice(1).map((r) => el('tr', {}, r.map((c) => el('td', { class: num.test(c.trim()) && c.trim() ? 'is-num' : null, text: c, title: c.length > 40 ? c : null }))))),
      ])]));
    } else {
      if (file.ext === 'json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* shown as it is */ } }
      host.append(el('pre', { class: 'gs-media__text', tabindex: '0', text }));
    }
    if (cut) host.append(el('div', { class: 'gs-media__note', text: t('Showing the first 2 MB. Download the file for the rest.') }));
  }).catch(() => {
    if (signal.aborted) return;
    wait.remove();
    fileCard(host, file, { why: t('The file could not be loaded.'), onDownload });
  });
  return { zoomable: false, destroy() {} };
}

/**
 * Show a file in `host` (emptied first).
 * @param o {source, thumbs, onZoom({level, fitted}), onSwipe(dir), onDownload()}
 * @returns {{zoomable, zoomIn?, zoomOut?, fit?, actual?, rotate?, media?, destroy}}
 */
export function showFile(host, file, o) {
  clear(host);
  const ctrl = new AbortController();
  const opts = { ...o, signal: ctrl.signal };
  let view;
  if (file.kind === 'image' || file.kind === 'heic') view = pictureView(host, file, opts);
  else if (file.kind === 'pdf') view = pdfView(host, file, opts);
  else if (file.kind === 'video' || file.kind === 'audio') view = mediaView(host, file, opts);
  else if (file.kind === 'text') view = textView(host, file, opts);
  else if (OFFICE.test(file.ext)) view = officeView(host, file, { ...opts, fail: (why) => fileCard(host, file, { why, onDownload: o.onDownload }) });
  else {
    fileCard(host, file, { why: t('There is no preview for this type of file.'), onDownload: o.onDownload });
    view = { zoomable: false, destroy() {} };
  }
  return { ...view, destroy() { ctrl.abort(); view.destroy(); clear(host); } };
}
