// The scrolling wall behind the Cards and Files layouts.
//
// Positions come from model/layout.js; this file only puts the cards, tiles and headers that are in
// sight (plus a screen's worth either side) into the DOM, keyed so a node survives scrolling and
// re-sorting, and takes them out again as they leave. Thumbnails are requested as a node appears and
// withdrawn as it goes, so fast scrolling through 10,000 files downloads only what was stopped on.
//
// Keyboard: the wall holds one "current" tile or card with tabindex 0 (a roving tab stop). Arrows move
// it, Enter opens, Space marks a file, Delete removes it from its record, Home and End jump.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { layoutFiles, layoutCards, visibleBlocks, locate, neighbour, listColumns, LIST_HEAD_H, tilesInRect } from '../model/layout.js';
import { flippable, coverOf, listSortState } from '../model/files.js';
import { shorten } from '../model/textsearch.js';
import { renderFace, fileLabel } from './face.js';
import { sizeText, typeLabel, tintOf } from '../model/kinds.js';
import { t, tn, uiLang, dateLocale } from '../i18n/index.js';

const OVERSCAN = 700;
const COARSE = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : { matches: false };
/** The drag type of tiles dragged inside the widget (files from the desktop come as 'Files'). */
export const INTERNAL_FILES = 'application/x-file-studio-files';
const INTERNAL = INTERNAL_FILES;

/** Where a search found its words in a file: "Page 3", "Pages 3, 7, 9…" or "In the text". */
export function hitWhere(hit) {
  if (!hit.paged) return t('In the text');
  if (hit.pages.length === 1) return t('Page {n}', { n: hit.pages[0] });
  return t('Pages {list}', { list: hit.pages.slice(0, 3).join(', ') + (hit.pages.length > 3 ? '…' : '') });
}

/**
 * @param on {onOpen(file), onSelect(rowId), onMark(file, mode: 'toggle'|'range'), onMenu(file, anchor), onDrop(rowId|null, files),
 *            onMarkSet(keys: Set) (a box was dragged), onSort(column) (a list heading was clicked), culture (for the dates), onRecordMenu(rowId, anchor), onSpaceMenu(anchor) (anchor: an element, or {x, y} where the right click was),
 *            onAdd(rowId), onView(rowId), onRemove(file), onFocusFile(file)}
 */
export function createWall(host, thumbs, on) {
  const scroll = el('div', { class: 'gs-scroll', tabindex: '-1', role: 'region', 'aria-label': t('Files') });
  const canvas = el('div', { class: 'gs-canvas', role: 'list' });
  scroll.append(canvas);
  clear(host).append(scroll);

  const S = {
    mode: 'files', width: 0, layout: null, data: null, nodes: new Map(), current: null, focusKey: null,
    marked: new Set(), cut: new Set(), editable: false, raf: 0, cardIndex: new Map(), off: 0, list: false, cols: [], colKey: '',
  };

  // ---- drawing -----------------------------------------------------------------------------------
  function relayout() {
    S.width = scroll.clientWidth || host.clientWidth || 800;
    if (!S.data) return;
    if (S.mode === 'files') {
      const d = S.data;
      S.layout = layoutFiles(d.groups, { width: S.width, size: d.size, fit: d.fit, grouped: d.grouped, captions: d.captions, fixed: thumbs.aspects });
      listState(d);
    } else {
      listState(null);
      const d = S.data;
      S.layout = layoutCards(d.records.length, { width: S.width, size: d.size, fields: d.fields });
    }
    canvas.style.height = S.layout.height + 'px';
    draw();
  }

  function schedule() {
    if (S.raf) return;
    S.raf = requestAnimationFrame(() => { S.raf = 0; draw(); });
  }

  function want() {
    // The items in sight, as [key, build, place] triples.
    const top = scroll.scrollTop - S.off - OVERSCAN, bottom = scroll.scrollTop + scroll.clientHeight - S.off + OVERSCAN;
    const out = [];
    for (const b of visibleBlocks(S.layout.blocks, top, bottom)) {
      if (b.kind === 'head') {
        const grp = S.data.groups[b.g];
        out.push(['h' + grp.rec.rowId, () => buildHead(grp), { top: b.y, height: b.h }]);
      } else if (b.kind === 'empty') {
        const grp = S.data.groups[b.g];
        out.push(['empty' + grp.rec.rowId, () => buildEmpty(grp), { top: b.y, height: b.h }]);
      } else if (b.kind === 'row') {
        for (const tile of b.tiles) {
          out.push([tile.f.key, () => (S.list ? buildRow(tile.f) : buildTile(tile.f, tile)), { left: tile.x, top: b.y, width: tile.w, height: tile.h }]);
          if (S.data.captions && !S.list) out.push(['cap' + tile.f.key, () => el('div', { class: 'gs-caption', text: tile.f.name, title: tile.f.name }), { left: tile.x, top: b.y + tile.h, width: tile.w }]);
        }
      } else if (b.kind === 'cards') {
        for (const c of b.cards) {
          const rec = S.data.records[c.i];
          out.push(['c' + rec.rowId, () => buildCard(rec), { left: c.x, top: b.y, width: c.w, height: b.h }]);
        }
      }
    }
    return out;
  }

  function draw() {
    if (!S.layout) return;
    const items = want();
    const keep = new Set(items.map((x) => x[0]));
    for (const [key, n] of S.nodes) {
      if (!keep.has(key) && key !== S.focusKey) { n.release?.(); n.node.remove(); S.nodes.delete(key); }
    }
    for (const [key, build, place] of items) {
      let n = S.nodes.get(key);
      if (!n) { n = build(); S.nodes.set(key, n); canvas.append(n.node); }
      const st = n.node.style;
      if (place.left != null) st.left = place.left + 'px';
      st.top = place.top + 'px';
      if (place.width != null) st.width = place.width + 'px';
      if (place.height != null) st.height = place.height + 'px';
      n.update?.();
    }
  }

  /** Throw every node away (the data under them changed). */
  function reset() {
    for (const n of S.nodes.values()) { n.release?.(); n.node.remove(); }
    S.nodes.clear();
  }

  // ---- a record's header (Files) --------------------------------------------------------------------
  /** " · 12 MB": the space the files shown take (nothing for an empty folder). */
  const sizeOf = (files) => { const n = files.reduce((a, f) => a + (Number(f.size) || 0), 0); return n ? ' · ' + sizeText(n, uiLang()) : ''; };
  function buildHead(grp) {
    const rec = grp.rec;
    const node = el('div', { class: 'gs-head', dataset: { row: String(rec.rowId), drop: t('Drop to add to {name}', { name: rec.title || t('this record') }) } }, [
      el('span', { class: 'gs-head__title', text: rec.title || t('Untitled record'), title: t('Select this record'), onclick: () => on.onSelect(rec.rowId) }),
      el('span', { class: 'gs-head__n', text: (grp.files.length === rec.files.length ? tn(rec.files.length, '{n} file', '{n} files') : t('{shown} of {n} files', { shown: grp.files.length, n: rec.files.length })) + sizeOf(grp.files) }),
      S.editable ? el('button', { type: 'button', class: 'gs-btn gs-head__add', title: t('Add files to this record'), onclick: () => on.onAdd(rec.rowId) }, [icon('plus'), t('Add')]) : null,
    ]);
    return { node, update: () => node.classList.toggle('is-current', S.current === rec.rowId) };
  }

  // What a tile and a row do alike: click, focus, drag, and the marks and focus they show.
  function wire(node, f) {
    node.addEventListener('click', (e) => {
      S.focusKey = f.key;
      if (e.shiftKey) { on.onMark(f, 'range'); return; }
      if (e.ctrlKey || e.metaKey || S.marked.size) { on.onMark(f, 'toggle'); return; }
      on.onOpen(f);
    });
    node.addEventListener('focus', () => { S.focusKey = f.key; on.onFocusFile?.(f); });
    // Drag a tile onto another record's heading or card to move it there (Ctrl or Alt: copy).
    node.addEventListener('dragstart', (e) => {
      if (!S.editable) { e.preventDefault(); return; }
      const keys = S.marked.has(f.key) ? [...S.marked] : [f.key];
      e.dataTransfer.setData(INTERNAL, JSON.stringify(keys));
      e.dataTransfer.effectAllowed = 'copyMove';
      node.classList.add('is-dragged');
    });
    node.addEventListener('dragend', () => node.classList.remove('is-dragged'));
  }
  function refresh(node, f) {
    // On a touch screen a long press opens the menu; a draggable element would start a drag instead (and drag and drop is for a mouse).
    node.draggable = S.editable && !f.readOnly && !COARSE.matches;
    node.classList.toggle('is-marked', S.marked.has(f.key));
    node.classList.toggle('is-cut', S.cut.has(f.key));
    node.setAttribute('aria-selected', S.marked.has(f.key) ? 'true' : 'false');
    node.tabIndex = f.key === focusTarget() ? 0 : -1;
  }

  // ---- the list: column headings and a row for a file ---------------------------------------------------------
  let listHead = null, dateFmt = null;
  /** Set up (or take away) the column headings for the data on show, and forget the rows when the columns changed. */
  function listState(d) {
    S.list = !!d && d.fit === 'list';
    scroll.classList.toggle('is-list', S.list);
    if (!S.list) { listHead?.remove(); listHead = null; S.off = 0; S.colKey = ''; return; }
    const anyTags = d.groups.some((g) => g.files.some((f) => f.tags && f.tags.length));
    S.cols = listColumns(S.width, { tags: anyTags, folder: !d.grouped });
    const key = S.cols.map((c) => c.id).join();
    if (key !== S.colKey) { S.colKey = key; reset(); }
    scroll.style.setProperty('--gs-cols', ['32px', '44px', 'minmax(0, 1fr)', ...S.cols.slice(1).map((c) => c.w + 'px'), '34px'].join(' '));
    if (!listHead) { listHead = el('div', { class: 'gs-listhead', role: 'group', 'aria-label': t('Sort the files by') }); scroll.insertBefore(listHead, canvas); }
    dateFmt = new Intl.DateTimeFormat(dateLocale(on.culture), { dateStyle: 'medium' });
    clear(listHead).append(el('span'), el('span'), ...S.cols.map(headCell), el('span'));
    S.off = LIST_HEAD_H;
  }
  function headCell(c) {
    const label = { name: t('Name'), type: t('Type'), size: t('Size'), added: t('Added'), tags: t('Tags'), folder: t('Record') }[c.id];
    if (!['name', 'type', 'size', 'added'].includes(c.id)) return el('span', { class: 'gs-listhead__cell', text: label });
    const state = listSortState(c.id, S.data.sort);
    // a button that says which way the list is sorted by it, for those who cannot see the arrow
    return el('span', { class: 'gs-listhead__cell' + (c.id === 'size' ? ' is-num' : '') + (state === 'none' ? '' : ' is-sorted') }, [
      el('button', { type: 'button', title: t('Sort by {column}', { column: label }), onclick: () => on.onSort?.(c.id) }, [
        label,
        state === 'none' ? null : el('span', { class: 'gs-listhead__dir', 'aria-hidden': 'true', text: state === 'ascending' ? '▲' : '▼' }),
        state === 'none' ? null : el('span', { class: 'gs-sr', text: ', ' + (state === 'ascending' ? t('sorted ascending') : t('sorted descending')) }),
      ]),
    ]);
  }
  function buildRow(f) {
    const where = f.hit ? hitWhere(f.hit) : '';
    const labelled = f.tags && f.tags.length ? f.tags.join(', ') : '';
    const node = el('div', {
      class: 'gs-row' + (f.hit ? ' has-hit' : ''), role: 'listitem', tabindex: '-1', dataset: { key: f.key, row: String(f.rowId) },
      'aria-label': fileLabel(f) + (where ? ', ' + where : '') + (labelled ? ', ' + labelled : ''),
      title: [f.name, f.hit ? f.hit.snippet : '', labelled ? '# ' + labelled : '', f.note || ''].filter(Boolean).join('\n'),
    });
    const mark = el('button', { type: 'button', class: 'gs-row__mark', 'aria-label': t('Mark'), tabindex: '-1',
      onclick: (e) => { e.stopPropagation(); on.onMark(f, e.shiftKey ? 'range' : 'toggle'); } }, [icon('check')]);
    // A picture, PDF or video shows its thumbnail; everything else shows its type on its own colour.
    const thumb = el('span', { class: 'gs-row__thumb gs-t-' + tintOf(f.ext) });
    const typeOnly = () => { thumb.classList.add('is-type'); thumb.replaceChildren(el('span', { class: 'gs-row__ext', text: typeLabel(f.ext) })); };
    let release = () => {};
    if (thumbs && ['image', 'heic', 'pdf', 'video'].includes(f.kind)) {
      const img = el('img', { class: 'gs-row__img', alt: '', decoding: 'async', draggable: false });
      thumb.append(img);
      let gone = false;
      const stop = thumbs.want(f, 64, (r) => {
        if (gone) return;
        if (r.failed || !r.url) { typeOnly(); return; }
        img.onload = () => img.classList.add('is-in');
        img.src = r.url;
      });
      release = () => { gone = true; stop(); };
    } else typeOnly();
    const [head, word, tail] = f.hit ? shorten(f.hit, 44) : [];
    const name = el('span', { class: 'gs-row__name' }, [
      el('span', { class: 'gs-row__nm', text: f.name }),
      f.hit ? el('span', { class: 'gs-row__hit' }, [el('b', { text: where }), ' ', head, el('mark', { text: word }), tail]) : null,
    ]);
    const cells = S.cols.slice(1).map((c) => {
      if (c.id === 'folder') return el('span', { class: 'gs-row__cell', text: f.recordTitle || '', title: f.recordTitle || '' });
      if (c.id === 'type') return el('span', { class: 'gs-row__cell', text: typeLabel(f.ext) });
      if (c.id === 'size') return el('span', { class: 'gs-row__cell gs-row__num', text: sizeText(f.size, uiLang()) });
      if (c.id === 'added') return el('span', { class: 'gs-row__cell', text: f.uploaded ? dateFmt.format(new Date(f.uploaded)) : '' });
      return el('span', { class: 'gs-row__cell gs-row__tags', text: labelled, title: labelled });
    });
    const more = el('button', { type: 'button', class: 'gs-row__more', 'aria-label': t('More for {name}', { name: f.name }), tabindex: '-1',
      onclick: (e) => { e.stopPropagation(); on.onMenu(f, more); } }, [icon('menu')]);
    node.append(mark, thumb, name, ...cells, more);
    wire(node, f);
    return { node, release, update: () => refresh(node, f) };
  }

  // A folder with no file yet: a line that says so and takes dropped files like its header does.
  function buildEmpty(grp) {
    const rec = grp.rec;
    const node = el('div', { class: 'gs-emptyrow', dataset: { row: String(rec.rowId), drop: t('Drop to add to {name}', { name: rec.title || t('this record') }) } }, [
      el('span', { text: t('No files in this folder yet.') }),
      S.editable ? el('span', { class: 'gs-emptyrow__hint', text: t('Drop files here, or press Add.') }) : null,
    ]);
    return { node };
  }

  // ---- a tile (Files) ----------------------------------------------------------------------------------
  function buildTile(f, tile) {
    const where = f.hit ? hitWhere(f.hit) : '';
    const labelled = (f.tags && f.tags.length ? f.tags.join(', ') : '');
    const node = el('div', {
      class: 'gs-tile' + (f.hit ? ' has-hit' : ''), role: 'listitem', tabindex: '-1', 'aria-label': fileLabel(f) + (where ? ', ' + where : '') + (labelled ? ', ' + labelled : ''), dataset: { key: f.key, row: String(f.rowId) },
      title: [f.name, f.hit ? f.hit.snippet : '', labelled ? '# ' + labelled : '', f.note || ''].filter(Boolean).join('\n'),
    });
    const release = renderFace(node, f, { thumbs, cssPx: Math.max(tile.w, tile.h) });
    const mark = el('button', { type: 'button', class: 'gs-tile__mark', 'aria-label': t('Mark'), tabindex: '-1',
      onclick: (e) => { e.stopPropagation(); on.onMark(f, e.shiftKey ? 'range' : 'toggle'); } }, [icon('check')]);
    const more = el('button', { type: 'button', class: 'gs-tile__more', 'aria-label': t('More for {name}', { name: f.name }), tabindex: '-1',
      onclick: (e) => { e.stopPropagation(); on.onMenu(f, more); } }, [icon('menu')]);
    node.append(mark, more);
    // After a search inside files: the page (or "in the text") and a few words around the match.
    if (f.hit) {
      // A small tile has room for the page only; the words around the match are in its tooltip.
      const [head, word, tail] = shorten(f.hit, 14);
      node.style.setProperty('--gs-hit-h', (tile.h >= 110 ? 50 : 22) + 'px');   // a document's paper stops above the band
      node.append(el('div', { class: 'gs-tile__hit' }, [el('b', { text: where }), tile.h >= 110 ? el('span', {}, [head, el('mark', { text: word }), tail]) : null]));
    }
    wire(node, f);
    return {
      node, release,
      update: () => refresh(node, f),
    };
  }

  // ---- a card (Cards) ---------------------------------------------------------------------------------
  function buildCard(rec) {
    const cover = el('div', { class: 'gs-card__cover', style: { height: S.layout.coverH + 'px' } });
    const node = el('div', {
      class: 'gs-card', role: 'listitem', tabindex: '-1', dataset: { row: String(rec.rowId), drop: t('Drop to add to {name}', { name: rec.title || t('this record') }) },
      'aria-label': (rec.title || t('Untitled record')) + ', ' + tn(rec.files.length, '{n} file', '{n} files'),
    });
    let release = () => {};
    const pics = flippable(rec);
    const first = coverOf(rec);
    if (first) {
      release = renderFace(cover, first, { thumbs, cssPx: S.layout.cardW, tags: false });
      cover.addEventListener('click', (e) => { e.stopPropagation(); on.onSelect(rec.rowId); on.onOpen(currentPic || first); });
      cover.append(el('span', { class: 'gs-card__count', text: tn(rec.files.length, '{n} file', '{n} files') }));
    } else {
      cover.classList.add('is-empty');
      cover.append(el('div', { class: 'gs-card__none' }, [icon('image2'), el('span', { text: t('No files yet') }), S.editable ? el('span', { text: t('Drop files here') }) : null]));
    }
    // Hover across the cover to flip through the record's pictures, as on a shop's product card.
    let currentPic = null, flipRelease = null;
    if (pics.length > 1) {
      const dots = el('div', { class: 'gs-card__dots', 'aria-hidden': 'true' }, pics.slice(0, 12).map((_, i) => el('span', { class: 'gs-card__dot' + (i ? '' : ' is-on') })));
      cover.append(dots);
      cover.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        const b = cover.getBoundingClientRect();
        const i = Math.max(0, Math.min(pics.length - 1, Math.floor(((e.clientX - b.left) / b.width) * Math.min(pics.length, 12))));
        if (pics[i] === (currentPic || pics[0])) return;
        currentPic = pics[i];
        [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k === i));
        flipRelease?.();
        const holder = el('div', { style: { position: 'absolute', inset: '0' } });
        flipRelease = renderFace(holder, currentPic, { thumbs, cssPx: S.layout.cardW, tags: false });
        cover.querySelector('.gs-flip')?.remove();
        holder.className = 'gs-flip';
        cover.insertBefore(holder, cover.querySelector('.gs-card__count'));
      });
      cover.addEventListener('pointerleave', () => {
        currentPic = null; flipRelease?.(); flipRelease = null;
        cover.querySelector('.gs-flip')?.remove();
        [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k === 0));
      });
    }
    const body = el('div', { class: 'gs-card__body' }, [
      el('div', { class: 'gs-card__title' + (rec.title ? '' : ' is-blank'), text: rec.title || t('Untitled record') }),
      ...rec.fields.slice(0, S.data.fields).map((f) => el('div', { class: 'gs-card__field' }, [
        el('span', { class: 'gs-card__label', text: f.label }),
        el('span', { class: 'gs-card__value' + (f.text ? '' : ' is-empty'), text: f.text || '—' }),
      ])),
    ]);
    const open = el('button', { type: 'button', class: 'gs-card__open', tabindex: '-1', text: t('View'), title: t('Show this record in the Viewer'),
      onclick: (e) => { e.stopPropagation(); on.onView(rec.rowId); } });
    node.append(cover, body, open);
    node.addEventListener('click', () => { S.focusKey = 'c' + rec.rowId; on.onSelect(rec.rowId); });
    node.addEventListener('dblclick', () => on.onView(rec.rowId));
    node.addEventListener('focus', () => { S.focusKey = 'c' + rec.rowId; });
    return {
      node, release: () => { release(); flipRelease?.(); },
      update: () => {
        node.classList.toggle('is-current', S.current === rec.rowId);
        node.tabIndex = 'c' + rec.rowId === focusTarget() ? 0 : -1;
      },
    };
  }

  // ---- the keyboard -------------------------------------------------------------------------------------
  function focusTarget() {
    if (S.focusKey && S.nodes.has(S.focusKey)) return S.focusKey;
    // Otherwise the first thing drawn, so Tab always lands somewhere.
    for (const k of S.nodes.keys()) if (!k.startsWith('h') && !k.startsWith('cap') && !k.startsWith('empty')) return k;
    return null;
  }
  function focusKey(key) {
    S.focusKey = key;
    scrollToKey(key);
    draw();
    S.nodes.get(key)?.node.focus({ preventScroll: true });
  }
  function scrollToKey(key) {
    let y = null, h = 0;
    if (S.mode === 'files') {
      const at = locate(S.layout.blocks, key);
      if (at) { y = at.block.y; h = at.block.h; }
    } else {
      const rowId = Number(key.slice(1));
      const i = S.data.records.findIndex((r) => r.rowId === rowId);
      const blk = S.layout.blocks.find((b) => b.cards.some((c) => c.i === i));
      if (blk) { y = blk.y; h = blk.h; }
    }
    if (y == null) return;
    const top = scroll.scrollTop, view = scroll.clientHeight;
    if (y < top + 8) scroll.scrollTop = Math.max(0, y - 12);
    else if (y + h + S.off > top + view - 8) scroll.scrollTop = y + h + S.off - view + 12;
  }
  function cardNeighbour(key, dir) {
    const rowId = Number(key.slice(1));
    const i = S.data.records.findIndex((r) => r.rowId === rowId);
    const cols = S.layout.cols;
    const j = { left: i - 1, right: i + 1, up: i - cols, down: i + cols }[dir];
    return S.data.records[j] ? 'c' + S.data.records[j].rowId : null;
  }
  scroll.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, .gs-menu')) return;
    const key = focusTarget();
    if (!key) return;
    const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (dirs[e.key]) {
      e.preventDefault();
      const next = S.mode === 'files' ? neighbour(S.layout.blocks, key, dirs[e.key]) : cardNeighbour(key, dirs[e.key]);
      if (next) { focusKey(next); if (S.mode === 'cards') on.onSelect(Number(next.slice(1))); else if (e.shiftKey) on.onMark(fileByKey(next), 'range'); }
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const keys = S.mode === 'files' ? S.layout.blocks.filter((b) => b.kind === 'row').flatMap((b) => b.tiles.map((x) => x.f.key)) : S.data.records.map((r) => 'c' + r.rowId);
      if (keys.length) focusKey(e.key === 'Home' ? keys[0] : keys[keys.length - 1]);
      return;
    }
    if (S.mode === 'files') {
      const f = fileByKey(key);
      if (!f) return;
      if (e.key === 'Enter') { e.preventDefault(); on.onOpen(f); }
      else if (e.key === ' ') { e.preventDefault(); on.onMark(f, e.shiftKey ? 'range' : 'toggle'); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && S.editable) { e.preventDefault(); on.onRemove(f); }
      else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); on.onMenu(f, S.nodes.get(key).node); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      on.onView(Number(key.slice(1)));
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      on.onRecordMenu?.(Number(key.slice(1)), S.nodes.get(key).node);
    }
  });
  // Right click: a file's menu on a tile, a folder's on its header, empty line or card, and the wall's own anywhere else.
  let lastMenuAt = 0;
  /** The menu for what is at a point: a file, a folder, or the wall. Once per touch or click (a phone sends both a long press and a contextmenu). */
  function menuAt(target, x, y) {
    if (Date.now() - lastMenuAt < 800) return;
    lastMenuAt = Date.now();
    const at = { x, y };
    const tile = S.mode === 'files' ? target.closest?.('.gs-tile, .gs-row') : null;
    if (tile) {
      const f = fileByKey(tile.dataset.key);
      if (f) { S.focusKey = f.key; on.onMenu(f, at); return; }
    }
    const row = target.closest?.('.gs-head, .gs-emptyrow, .gs-card');
    if (row) { on.onRecordMenu?.(Number(row.dataset.row), at); return; }
    on.onSpaceMenu?.(at);
  }
  scroll.addEventListener('contextmenu', (e) => {
    if (e.target.closest?.('input, textarea, .gs-menu')) return;
    e.preventDefault();
    menuAt(e.target, e.clientX, e.clientY);
  });
  // A long press (half a second without moving) does the same with a finger or a pen: phones and tablets have no right button, and
  // not every browser sends a contextmenu for a press inside a widget. The click that ends the press is swallowed.
  let press = null;
  scroll.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.button > 0 || e.target.closest?.('input, textarea, select, .gs-menu, .gs-listhead')) return;
    const at = { x: e.clientX, y: e.clientY };
    const target = e.target;
    press = { id: e.pointerId, at, timer: setTimeout(() => {
      press = null;
      try { navigator.vibrate?.(12); } catch { /* not allowed */ }
      menuAt(target, at.x, at.y);
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      scroll.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => scroll.removeEventListener('click', swallow, true), 900);
    }, 500) };
  });
  const endPress = (e) => { if (press && e.pointerId === press.id) { clearTimeout(press.timer); press = null; } };
  scroll.addEventListener('pointermove', (e) => { if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.at.x, e.clientY - press.at.y) > 9) endPress(e); });
  scroll.addEventListener('pointerup', endPress);
  scroll.addEventListener('pointercancel', endPress);
  scroll.addEventListener('scroll', () => { if (press) { clearTimeout(press.timer); press = null; } }, { passive: true });
  function fileByKey(key) {
    for (const g of S.data?.groups || []) { const f = g.files.find((x) => x.key === key); if (f) return f; }
    return null;
  }

  // ---- a box dragged over the wall marks the files it touches ------------------------------------------------------------
  // Start on empty ground (between tiles, beside a short row, below the last one), drag, let go. Ctrl or Shift adds to the marks that were
  // there; without them the box marks only what it touches, and a click on empty ground unmarks. The files are found from the layout, not
  // from the page, so tiles that are not drawn at the moment count too.
  let lasso = null;
  scroll.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType !== 'mouse' || S.mode !== 'files') return;
    if (e.target.closest?.('.gs-tile, .gs-row, .gs-head, .gs-emptyrow, .gs-caption, button, input, select, a, .gs-listhead')) return;
    if (e.offsetX > scroll.clientWidth) return;   // the scroll bar
    const at = canvas.getBoundingClientRect();
    lasso = { id: e.pointerId, x: e.clientX - at.left, y: e.clientY - at.top, add: e.ctrlKey || e.metaKey || e.shiftKey, base: new Set(S.marked), moved: false, band: null };
    scroll.setPointerCapture(e.pointerId);
  });
  scroll.addEventListener('pointermove', (e) => {
    if (!lasso || e.pointerId !== lasso.id) return;
    const at = canvas.getBoundingClientRect();
    const x = e.clientX - at.left, y = e.clientY - at.top;
    if (!lasso.moved && Math.hypot(x - lasso.x, y - lasso.y) < 5) return;
    if (!lasso.moved) { lasso.moved = true; lasso.band = el('div', { class: 'gs-lasso', 'aria-hidden': 'true' }); canvas.append(lasso.band); scroll.classList.add('is-lassoing'); }
    // near the top or bottom edge: scroll on
    const sb = scroll.getBoundingClientRect();
    if (e.clientY < sb.top + 24) scroll.scrollTop -= 14; else if (e.clientY > sb.bottom - 24) scroll.scrollTop += 14;
    const rect = { x1: lasso.x, y1: lasso.y, x2: x, y2: y };
    Object.assign(lasso.band.style, { left: Math.min(rect.x1, rect.x2) + 'px', top: Math.min(rect.y1, rect.y2) + 'px', width: Math.abs(rect.x2 - rect.x1) + 'px', height: Math.abs(rect.y2 - rect.y1) + 'px' });
    const keys = tilesInRect(S.layout.blocks, rect);
    on.onMarkSet?.(lasso.add ? new Set([...lasso.base, ...keys]) : new Set(keys));
  });
  const endLasso = (e) => {
    if (!lasso || e.pointerId !== lasso.id) return;
    const l = lasso;
    lasso = null;
    l.band?.remove();
    scroll.classList.remove('is-lassoing');
    try { scroll.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    // a click on empty ground (no box) unmarks, as on a computer
    if (!l.moved && !l.add && S.marked.size) on.onMarkSet?.(new Set());
  };
  scroll.addEventListener('pointerup', endLasso);
  scroll.addEventListener('pointercancel', endLasso);

  // ---- dropping files ------------------------------------------------------------------------------------
  let dropOver = null;
  const internal = (e) => [...(e.dataTransfer?.types || [])].includes(INTERNAL);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files') || internal(e);
  const targetOf = (e) => (S.editable ? e.target.closest?.('[data-row]') : null);
  scroll.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || !S.editable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = internal(e) && !(e.ctrlKey || e.altKey) ? 'move' : 'copy';
    let tgt = targetOf(e);
    // In the Files layout a tile stands for its record: light up the record's header.
    if (tgt && (tgt.classList.contains('gs-tile') || tgt.classList.contains('gs-row'))) tgt = S.nodes.get('h' + tgt.dataset.row)?.node || tgt;
    if (tgt !== dropOver) { dropOver?.classList.remove('is-drop-target'); dropOver = tgt; dropOver?.classList.add('is-drop-target'); }
  });
  scroll.addEventListener('dragleave', (e) => { if (!scroll.contains(e.relatedTarget)) { dropOver?.classList.remove('is-drop-target'); dropOver = null; } });
  scroll.addEventListener('drop', (e) => {
    if (!hasFiles(e) || !S.editable) return;
    e.preventDefault();
    e.stopPropagation();
    dropOver?.classList.remove('is-drop-target');
    const row = dropOver?.dataset.row || targetOf(e)?.dataset.row;
    dropOver = null;
    if (internal(e)) {
      let keys = [];
      try { keys = JSON.parse(e.dataTransfer.getData(INTERNAL) || '[]'); } catch { /* not ours after all */ }
      if (row && keys.length) on.onSendFiles(keys, Number(row), e.ctrlKey || e.altKey ? 'copy' : 'move');
      return;
    }
    on.onDrop(row ? Number(row) : null, [...e.dataTransfer.files]);
  });

  scroll.addEventListener('scroll', schedule, { passive: true });
  // A new layout changes the wall's height, which can bring the scrollbar in or take it away, which
  // changes the width, which asks for a new layout: a loop that froze the page in testing. The
  // gutter is reserved in CSS (scrollbar-gutter), and where that is not supported, a width that only
  // flips between the two it just had is ignored.
  const widths = [];
  const ro = new ResizeObserver(() => {
    const w = scroll.clientWidth || 0;
    if (Math.abs(w - S.width) <= 1) { schedule(); return; }
    widths.push(w);
    if (widths.length > 4) widths.shift();
    if (widths.length === 4 && widths[0] === widths[2] && widths[1] === widths[3]) { schedule(); return; }
    relayout();
  });
  ro.observe(scroll);

  return {
    /** Show the Files layout. d: {groups, size, fit, grouped, captions} */
    setFiles(d, { keepScroll = true } = {}) {
      const changed = S.mode !== 'files';
      S.mode = 'files';
      S.data = d;
      scroll.classList.toggle('gs-fit-whole', d.fit === 'square' && d.whole);
      S.colKey = '';
      reset();
      if (changed || !keepScroll) scroll.scrollTop = 0;
      relayout();
    },
    /** Show the Cards layout. d: {records, size, fields, cover} */
    setCards(d, { keepScroll = true } = {}) {
      const changed = S.mode !== 'cards';
      S.mode = 'cards';
      S.data = d;
      scroll.classList.toggle('gs-cover-fit', d.cover === 'fit');
      reset();
      if (changed || !keepScroll) scroll.scrollTop = 0;
      relayout();
    },
    setState({ current, marked, editable, cut }) {
      if (cut !== undefined) S.cut = cut;
      if (current !== undefined) S.current = current;
      if (marked !== undefined) S.marked = marked;
      if (editable !== undefined) S.editable = editable;
      scroll.classList.toggle('has-marks', S.marked.size > 0);
      for (const n of S.nodes.values()) n.update?.();
    },
    /** A picture turned out another shape than Grist said: lay out again, keeping the place. */
    reflow() { if (S.mode === 'files') { const top = scroll.scrollTop; reset(); relayout(); scroll.scrollTop = top; } },
    scrollToRecord(rowId) {
      if (S.mode === 'cards') { if (S.data?.records.some((r) => r.rowId === rowId)) { scrollToKey('c' + rowId); draw(); } return; }
      const g = S.data?.groups.findIndex((x) => x.rec.rowId === rowId);
      const blk = g >= 0 ? S.layout.blocks.find((b) => b.g === g) : null;
      if (blk && (blk.y < scroll.scrollTop || blk.y + S.off > scroll.scrollTop + scroll.clientHeight - 60)) { scroll.scrollTop = Math.max(0, blk.y - 8); draw(); }
    },
    /** The file with the keyboard focus (Files layout), or null. */
    focusedFile() { return S.mode === 'files' ? fileByKey(S.focusKey) : null; },
    scrollToTop() { scroll.scrollTop = 0; },
    focusFile(key) { if (S.mode === 'files' && fileByKey(key)) focusKey(key); },
    focus() { const k = focusTarget(); if (k) S.nodes.get(k)?.node.focus({ preventScroll: true }); else scroll.focus(); },
    files() { return S.mode === 'files' ? (S.data?.groups || []).flatMap((g) => g.files) : []; },
    destroy() { ro.disconnect(); cancelAnimationFrame(S.raf); reset(); scroll.remove(); },
  };
}
