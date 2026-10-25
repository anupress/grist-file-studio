// The lightbox: any file, as large as the widget allows, in a dark room.
//
// It steps through the list it was opened with (the files as the wall shows them: filtered, sorted),
// with arrows, keys, swipes or the filmstrip. Grist's frame has no fullscreen permission, so "large"
// means the whole widget; Open in new tab is there for more.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { showFile } from './stage.js';
import { renderFace, durationText } from './face.js';
import { typeLabel, sizeText } from '../model/kinds.js';
import { SPEEDS, speedFrom, dwell, nextIndex, nearestImage } from '../model/viewing.js';
import { cameraName, mapLink, placeText } from '../media/exif.js';
import { trapFocus, openMenu } from '../ui/dialog.js';
import { placesList, placesSummary } from '../ui/rowcard.js';
import { t, uiLang, dateLocale } from '../i18n/index.js';

const btn = (name, label, onclick, extra = {}) => el('button', { type: 'button', class: 'gs-lb__btn', title: label, 'aria-label': label, onclick, ...extra }, [icon(name)]);

/**
 * @param o {files, index, source, thumbs, culture, canEdit(file) -> bool, onRecord(file), onDownload(file), onOpenTab(file),
 *           onRename(file), onCover(file), onRemove(file), onClose(), onShow(file), onCompare(file, other)}
 */
export function openLightbox(host, o) {
  let files = o.files.slice();
  let i = Math.max(0, Math.min(files.length - 1, o.index || 0));
  let view = null;
  let showInfo = false;
  const stripReleases = [];
  // The slideshow: on to the next file after a while (a picture 3, 5 or 8 seconds, a document twice that, video and audio when they end).
  let playing = false, timer = 0, ended = null;
  let speed = SPEEDS[1];
  try { speed = speedFrom(localStorage.getItem('file-studio-slide-speed')); } catch { /* private window */ }

  const name = el('span', { class: 'gs-lb__name' });
  const meta = el('span', { class: 'gs-lb__meta' });
  const record = el('button', { type: 'button', class: 'gs-lb__record', title: t('Select this record in Grist'), onclick: () => o.onRecord(files[i]) });
  const rotateBtn = btn('refresh2', t('Rotate the view (R)'), () => view?.rotate?.(1));
  const zoomText = el('button', { type: 'button', class: 'gs-lb__zoom', title: t('Fit (0) / 100 % (1)'), onclick: () => (view?.fitted === false ? view.fit() : view?.actual?.()) });
  const zoomTools = el('span', { class: 'gs-lb__zoomtools' }, [
    btn('zoomOut', t('Zoom out (−)'), () => view?.zoomOut()), zoomText, btn('zoomIn', t('Zoom in (+)'), () => view?.zoomIn()),
    rotateBtn,
    el('span', { class: 'gs-lb__sep' }),
  ]);
  const playBtn = btn('play2', t('Slideshow (S)'), () => toggleShow(), { 'aria-pressed': 'false' });
  const infoBtn = btn('info', t('Details (I)'), () => toggleInfo());
  // Edit: pictures and text files open in an editor; the button is there only for those.
  const editBtn = el('button', { type: 'button', class: 'gs-btn gs-lb__edit', title: t('Edit this file (E)'), onclick: () => o.onEdit(files[i]) }, [icon('edit'), t('Edit')]);
  const moreBtn = btn('menu', t('More'), () => more());
  const bar = el('div', { class: 'gs-lb__bar' }, [
    name, meta, record,
    el('div', { class: 'gs-lb__tools' }, [
      editBtn,
      zoomTools,
      btn('download2', t('Download (D)'), () => o.onDownload(files[i])),
      btn('external', t('Open in a new tab'), () => o.onOpenTab(files[i]), { class: 'gs-lb__btn gs-lb__tab' }),
      playBtn, infoBtn, moreBtn,
      el('span', { class: 'gs-lb__sep' }),
      btn('close', t('Close (Esc)'), () => close()),
    ]),
  ]);
  const stage = el('div', { class: 'gs-lb__stage' });
  const prev = el('button', { type: 'button', class: 'gs-lb__arrow gs-lb__arrow--prev', 'aria-label': t('Previous (←)'), onclick: () => go(i - 1) }, [icon('arrowLeft')]);
  const next = el('button', { type: 'button', class: 'gs-lb__arrow gs-lb__arrow--next', 'aria-label': t('Next (→)'), onclick: () => go(i + 1) }, [icon('arrowRight')]);
  const tick = el('div', { class: 'gs-lb__tick', hidden: true, 'aria-hidden': 'true' });
  const info = el('aside', { class: 'gs-lb__info', 'aria-label': t('Details'), hidden: true });
  const body = el('div', { class: 'gs-lb__body' }, [el('div', { class: 'gs-lb__stage-wrap', style: { flex: '1', minWidth: '0', position: 'relative', display: 'flex' } }, [stage, prev, next, tick]), info]);
  stage.style.flex = '1';
  const strip = el('div', { class: 'gs-lb__strip', role: 'listbox', 'aria-label': t('All files') });
  // After a search inside files: where the words were found, with a way through the pages that hold them.
  const found = el('div', { class: 'gs-lb__found', hidden: true });
  const box = el('div', { class: 'gs-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('File viewer'), tabindex: '-1' }, [bar, found, body, strip]);
  host.append(box);
  const release = trapFocus(box, () => close());

  function fmtDate(ms) {
    try { return new Intl.DateTimeFormat(dateLocale(o.culture), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)); } catch { return new Date(ms).toISOString(); }
  }
  function renderInfo() {
    const f = files[i];
    const th = o.thumbs?.peek(f, 720) || o.thumbs?.peek(f, 360);
    const w = th?.w || f.w, h = th?.h || f.h;
    const rows = [
      [t('Name'), f.name],
      [t('Type'), typeLabel(f.ext)],
      [t('Size'), sizeText(f.size, uiLang())],
      (f.kind === 'image' || f.kind === 'video') && w && h ? [t('Dimensions'), `${Math.round(w)} × ${Math.round(h)} px`] : null,
      th?.extra?.pages ? [t('Pages'), String(th.extra.pages)] : null,
      th?.extra?.duration ? [t('Length'), durationText(th.extra.duration)] : null,
      f.uploaded ? [t('Uploaded'), fmtDate(f.uploaded)] : null,
    ].filter(Boolean);
    const fileList = el('dl', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
    clear(info).append(
      el('h3', { text: t('File') }),
      fileList,
      el('h3', { text: t('Record') }),
      el('dl', {}, [el('dt', { text: t('Title') }), el('dd', { text: f.recordTitle || '—' }), el('dt', { text: t('Column') }), el('dd', { text: f.colLabel || f.col })]),
      el('button', { type: 'button', class: 'gs-btn gs-lb__go', text: t('Select this record'), onclick: () => o.onRecord(f) }),
    );
    // What the photo says about itself, once it has been read (the start of the file only).
    if (o.exifOf && f.kind === 'image') {
      o.exifOf(f).then((x) => {
        if (!x || files[i] !== f || !showInfo) return;
        const more = [];
        if (x.taken != null) more.push([t('Taken'), new Intl.DateTimeFormat(dateLocale(o.culture), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(x.taken))]);
        const cam = cameraName(x.make, x.model);
        if (cam) more.push([t('Camera'), cam]);
        if (x.lat != null && x.lon != null) more.push([t('Place'), el('a', { href: mapLink(x.lat, x.lon), target: '_blank', rel: 'noopener noreferrer', text: placeText(x.lat, x.lon), title: t('Open the place on a map') })]);
        for (const [k, v] of more) fileList.append(el('dt', { text: k }), el('dd', {}, [v]));
      }).catch(() => {});
    }
    // Where it is: every cell in the document holding this file. Read on demand, it can take a moment.
    if (o.whereIs) {
      const head = el('h3', { text: t('Where it is') });
      const slot = el('div', { class: 'gs-places__slot' }, [el('p', { class: 'gs-places__none', text: t('Looking through the document…') })]);
      info.append(head, slot);
      o.whereIs(f).then((places) => {
        if (files[i] !== f || !showInfo) return;
        head.textContent = t('Where it is') + ' · ' + placesSummary(places.length);
        clear(slot).append(placesList(places, { onRow: (p) => o.onShowRow(p) }));
      }).catch((e) => { clear(slot).append(el('p', { class: 'gs-places__none', text: t('Could not read the document: {why}', { why: String(e?.message || e) }) })); });
    }
  }
  function toggleInfo() { showInfo = !showInfo; info.hidden = !showInfo; infoBtn.classList.toggle('is-on', showInfo); if (showInfo) renderInfo(); }

  function more() {
    const here = files[i];
    const after = nearestImage(files, i, 1), before = nearestImage(files, i, -1);
    const extra = [
      ...(here.kind === 'image' && o.onCompare ? [
        null,
        [t('Compare with the next picture'), () => o.onCompare(here, files[after]), { disabled: after < 0, hint: t('Drag a divider between them') }],
        [t('Compare with the previous picture'), () => o.onCompare(here, files[before]), { disabled: before < 0 }],
      ] : []),
      ...(files.length > 1 ? [null, ...SPEEDS.map((n) => [(n === speed ? '✓ ' : '') + t('Slideshow: {n} seconds a picture', { n }), () => setSpeed(n)])] : []),
    ];
    openMenu(box, moreBtn, [...o.menuItems(here, { inLightbox: true }), ...extra]);
  }

  // ---- the slideshow ----
  function stopTimer() {
    clearTimeout(timer); timer = 0;
    if (ended) { ended.media.removeEventListener('ended', ended.fn); ended = null; }
    tick.hidden = true; tick.style.animation = 'none';
  }
  function advance() { go(nextIndex(i, files.length)); }
  function schedule() {
    stopTimer();
    if (!playing || files.length < 2) return;
    const sec = dwell(files[i].kind, speed);
    if (sec == null) {   // video and audio play to their end
      const m = view && view.media;
      if (m) {
        if (m.play) m.play().catch(() => {});
        const fn = () => advance();
        m.addEventListener('ended', fn, { once: true });
        ended = { media: m, fn };
        timer = setTimeout(advance, 10 * 60e3);
      } else timer = setTimeout(advance, speed * 1000);
      return;
    }
    tick.hidden = false; tick.style.animation = 'none'; void tick.offsetWidth;
    tick.style.animation = `gs-tick ${sec}s linear forwards`;
    timer = setTimeout(advance, sec * 1000);
  }
  function toggleShow() {
    if (files.length < 2) return;
    playing = !playing;
    playBtn.classList.toggle('is-on', playing);
    playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    const label = playing ? t('Stop the slideshow (S)') : t('Slideshow (S)');
    playBtn.title = label; playBtn.setAttribute('aria-label', label);
    schedule();
  }
  function setSpeed(n) {
    speed = n;
    try { localStorage.setItem('file-studio-slide-speed', String(n)); } catch { /* private window: not kept */ }
    if (playing) schedule();
  }

  function renderStrip() {
    stripReleases.splice(0).forEach((r) => r());
    clear(strip);
    if (files.length < 2) { strip.hidden = true; return; }
    strip.hidden = false;
    // A long list draws the 60 around the current file; the rest are a scroll away in the wall.
    const from = Math.max(0, Math.min(i - 30, files.length - 60)), to = Math.min(files.length, from + 60);
    for (let k = from; k < to; k++) {
      const f = files[k];
      const item = el('button', { type: 'button', class: 'gs-strip__item' + (k === i ? ' is-on' : ''), role: 'option', 'aria-selected': k === i ? 'true' : 'false',
        title: f.name, 'aria-label': f.name, onclick: () => go(k) });
      stripReleases.push(renderFace(item, f, { thumbs: o.thumbs, cssPx: 64, tags: false }));
      strip.append(item);
    }
    strip.querySelector('.is-on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function renderFound(hit) {
    found.hidden = !hit;
    clear(found);
    if (!hit) return;
    const pages = hit.paged ? hit.pages : [];
    let at = 0;
    const where = el('span', { class: 'gs-lb__where' });
    const label = () => { where.textContent = pages.length ? t('Found on page {n}', { n: pages[at] }) : t('Found in the text'); };
    label();
    found.append(where, el('span', { class: 'gs-lb__snippet', title: hit.snippet }, [hit.parts[0], el('mark', { text: hit.parts[1] }), hit.parts[2]]));
    if (pages.length > 1) {
      const count = el('span', { class: 'gs-lb__count', text: t('{k} of {m}', { k: 1, m: pages.length }) });
      found.append(count, el('button', { type: 'button', class: 'gs-btn gs-lb__nextmatch', text: t('Next match'), onclick: () => {
        at = (at + 1) % pages.length;
        label();
        count.textContent = t('{k} of {m}', { k: at + 1, m: pages.length });
        view?.goTo?.(pages[at]);
      } }));
    }
  }

  function show() {
    view?.destroy();
    const f = files[i];
    const hit = o.hitOf?.(f) || null;
    renderFound(hit);
    name.textContent = f.name;
    name.title = f.name;
    meta.textContent = `${i + 1} / ${files.length} · ${typeLabel(f.ext)} · ${sizeText(f.size, uiLang())}`;
    record.textContent = f.recordTitle || '';
    record.hidden = !f.recordTitle;
    prev.hidden = i <= 0;
    next.hidden = i >= files.length - 1;
    view = showFile(stage, f, {
      source: o.source, thumbs: o.thumbs, culture: o.culture, page: hit?.paged ? hit.pages[0] : 1,
      onZoom: (z) => { view && (view.fitted = z.fitted); zoomText.textContent = Math.round(z.level * 100) + ' %'; },
      onSwipe: (d) => go(i + d),
      onDownload: () => o.onDownload(f),
    });
    zoomTools.hidden = !view.zoomable;
    editBtn.hidden = !o.canEditContent(f);
    rotateBtn.hidden = !view.rotate;
    if (showInfo) renderInfo();
    renderStrip();
    playBtn.hidden = files.length < 2;
    if (playing && files.length < 2) toggleShow(); else schedule();
    o.onShow?.(f);
  }
  function go(k) {
    if (k < 0 || k >= files.length || k === i) return;
    i = k;
    show();
  }
  function close() {
    stopTimer();
    view?.destroy();
    stripReleases.splice(0).forEach((r) => r());
    box.removeEventListener('keydown', onKey);
    release();
    box.remove();
    o.onClose?.(files[i]);
  }
  function onKey(e) {
    if (e.target.closest('input, textarea, select, .gs-menu, .gs-dialog') || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'ArrowLeft' || k === 'PageUp') { handled(); go(i - 1); }
    else if (k === 'ArrowRight' || k === 'PageDown') { handled(); go(i + 1); }
    else if (k === 'Home') { handled(); go(0); }
    else if (k === 'End') { handled(); go(files.length - 1); }
    else if ((k === '+' || k === '=') && view?.zoomable) { handled(); view.zoomIn(); }
    else if ((k === '-' || k === '_') && view?.zoomable) { handled(); view.zoomOut(); }
    else if (k === '0' && view?.zoomable) { handled(); view.fit(); }
    else if (k === '1' && view?.zoomable) { handled(); view.actual(); }
    else if ((k === 'r' || k === 'R') && view?.rotate) { handled(); view.rotate(e.shiftKey ? -1 : 1); }
    else if (k === 'i' || k === 'I') { handled(); toggleInfo(); }
    else if ((k === 's' || k === 'S') && files.length > 1) { handled(); toggleShow(); }
    else if (k === 'd' || k === 'D') { handled(); o.onDownload(files[i]); }
    else if ((k === 'e' || k === 'E') && o.canEditContent(files[i])) { handled(); o.onEdit(files[i]); }
    else if ((k === 'Delete') && o.canEdit(files[i])) { handled(); o.onRemove(files[i]); }
    else if (k === ' ' && view?.media) { handled(); view.media.paused ? view.media.play() : view.media.pause(); }
  }
  box.addEventListener('keydown', onKey);
  show();
  box.focus({ preventScroll: true });

  return {
    close,
    /** The files changed under the lightbox (a removal, a rename): keep showing the same file, or the next one. */
    update(newFiles) {
      const cur = files[i];
      files = newFiles.slice();
      if (!files.length) { close(); return; }
      const same = files.findIndex((f) => f.key === cur.key) >= 0 ? files.findIndex((f) => f.key === cur.key)
        : files.findIndex((f) => f.attId === cur.attId && f.rowId === cur.rowId);
      if (same >= 0) {
        const changed = files[same].name !== cur.name;
        i = same;
        if (changed) { name.textContent = files[i].name; if (showInfo) renderInfo(); }
        meta.textContent = `${i + 1} / ${files.length} · ${typeLabel(files[i].ext)} · ${sizeText(files[i].size, uiLang())}`;
        renderStrip();
        return;
      }
      i = Math.min(i, files.length - 1);
      show();
    },
    current: () => files[i],
  };
}
