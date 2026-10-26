// What a file looks like small: on a tile, a card's cover, a filmstrip.
//
// Pictures, PDFs and videos show their thumbnail (made by media/thumbs.js), with a small tag for what
// is not obvious from the picture: a PDF's page count, a video's length. Everything else is drawn as
// a sheet of paper with the file type on a coloured tab and the name on it; a text file shows its
// first lines, so a wall of notes can be read at a glance. A thumbnail that fails falls back to paper.

import { el } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { typeLabel, tintOf, sizeText } from '../model/kinds.js';
import { t, tn, uiLang } from '../i18n/index.js';

const PICTURED = new Set(['image', 'heic', 'pdf', 'video']);
export const ALPHA = /^(png|apng|gif|webp|avif|svg|ico)$/;

/** 0:42, 12:05, 1:02:03 */
export function durationText(secs) {
  if (!(secs > 0) || !isFinite(secs)) return '';
  const s = Math.round(secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
}

/** The name with a break opportunity before its extension, so a long name wraps at the dot, not mid-word. */
function nameNode(file) {
  const dot = file.name.lastIndexOf('.');
  return dot > 0 ? [file.name.slice(0, dot), el('wbr'), file.name.slice(dot)] : [file.name];
}

function paper(file, { text = null, media = null } = {}) {
  const tint = 'gs-t-' + tintOf(file.ext);
  if (media) {
    return el('div', { class: 'gs-paper gs-paper--media ' + tint }, [
      icon(media),
      el('span', { class: 'gs-paper__type', text: typeLabel(file.ext) }),
      el('div', { class: 'gs-paper__name' }, nameNode(file)),
      el('div', { class: 'gs-paper__size', text: sizeText(file.size, uiLang()) }),
    ]);
  }
  return el('div', { class: 'gs-paper ' + tint }, [
    el('span', { class: 'gs-paper__type', text: typeLabel(file.ext) }),
    text ? el('div', { class: 'gs-paper__text', text }) : null,
    el('div', { class: 'gs-paper__name' }, nameNode(file)),
    el('div', { class: 'gs-paper__size', text: sizeText(file.size, uiLang()) }),
  ]);
}

/**
 * Fill `host` (a positioned element) with the file's face, and start loading its thumbnail.
 * @param o {thumbs, cssPx: the size it is shown at, tags: show the PDF/video tag}
 * @returns {Function} release — withdraws the thumbnail request; call it when the face leaves the screen
 */
export function renderFace(host, file, { thumbs, cssPx = 200, tags = true } = {}) {
  if (file.kind === 'audio') {
    const face = paper(file, { media: 'music' });
    host.append(face);
    return thumbs ? thumbs.want(file, cssPx, (r) => {
      const d = durationText(r.extra?.duration);
      if (d) face.querySelector('.gs-paper__size').textContent = `${d} · ${sizeText(file.size, uiLang())}`;
    }) : () => {};
  }
  if (file.kind === 'text') {
    const face = paper(file);
    host.append(face);
    return thumbs ? thumbs.want(file, cssPx, (r) => {
      if (r.extra?.text) face.insertBefore(el('div', { class: 'gs-paper__text', text: r.extra.text }), face.querySelector('.gs-paper__name'));
    }) : () => {};
  }
  if (!PICTURED.has(file.kind) || !thumbs) {
    host.append(paper(file));
    return () => {};
  }
  // Formats that can be transparent get a light checkerboard behind them: dark lines on a transparent
  // floor plan would vanish on a dark tile or in the lightbox. Opaque pictures cover it completely.
  const img = el('img', { class: 'gs-tile__img' + (ALPHA.test(file.ext) ? ' gs-alpha' : ''), alt: '', decoding: 'async' });
  img.draggable = false;   // el() leaves out a false property, so this is set here: a picture dragged by the browser would drop on the widget as a new file
  host.append(img);
  host.classList.add('is-loading');
  let done = false;
  const release = thumbs.want(file, cssPx, (r) => {
    if (done) return;
    done = true;
    host.classList.remove('is-loading');
    if (r.failed || !r.url) {
      img.remove();
      host.append(paper(file, file.kind === 'video' ? { media: 'video2' } : {}));
      return;
    }
    img.onload = () => img.classList.add('is-in');
    img.src = r.url;
    if (!tags) return;
    if (file.kind === 'pdf') host.append(el('span', { class: 'gs-tile__tag' }, [r.extra?.pages ? tn(r.extra.pages, 'PDF · {n} page', 'PDF · {n} pages') : 'PDF']));
    if (file.kind === 'video') {
      host.append(el('span', { class: 'gs-play', 'aria-hidden': 'true' }));
      const d = durationText(r.extra?.duration);
      if (d) host.append(el('span', { class: 'gs-tile__tag', text: d }));
    }
  });
  return () => { done = true; release(); };
}

/** The words a screen reader hears for a file: name, type, record. */
export function fileLabel(file) {
  const kind = { image: t('picture'), heic: t('picture'), pdf: 'PDF', video: t('video'), audio: t('audio'), text: t('text file') }[file.kind] || typeLabel(file.ext);
  return file.recordTitle ? t('{name}, {kind}, in {record}', { name: file.name, kind, record: file.recordTitle }) : `${file.name}, ${kind}`;
}
