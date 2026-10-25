// The Pages tab of the PDF editor: every page as a thumbnail you can select, drag into place, turn, remove,
// copy, take out as a new file or split into several, and add pages to from other PDFs and photos.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { renderPage } from '../media/pdf.js';
import { norm, turnElement, splitGroups } from '../media/pdfops.js';
import { trapFocus } from '../ui/dialog.js';
import { group, chips, button } from '../ui/controls.js';
import { t, tn } from '../i18n/index.js';

const THUMB_W = 132, THUMB_H = 172;
const SPLIT_LABELS = { each: 'Every page on its own', every: 'Every few pages', ranges: 'By page ranges' };
const SPLIT_ERRORS = { empty: 'Type the pages to take, for example 1-3, 5, 8-.', syntax: 'That is not a page range. Try 1-3, 5, 8-.', range: 'A page is outside this document, or a range runs backwards.' };

export function createPagesView(ctx) {
  const grid = el('div', { class: 'gs-pe__grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': t('Pages'), tabindex: '-1' });
  const stage = el('div', { class: 'gs-ed__stage gs-pe__stage' }, [grid]);
  const sel = new Set();
  const tiles = new Map();         // page id -> {node, canvas, num, badge, from, drawn}
  let focusId = null, anchorId = null, sortable = null, running = 0;
  const queue = [];

  const picked = () => ctx.S.pages.filter((p) => sel.has(p.id));
  const thumbSize = (entry) => {
    const { w, h } = ctx.pageSize(entry);
    const k = Math.min(THUMB_W / w, THUMB_H / h);
    return { w: Math.round(w * k), h: Math.round(h * k) };
  };

  // ---- the tiles ----
  function makeTile(entry) {
    const canvas = el('canvas', { class: 'gs-pe__thumb', 'aria-hidden': 'true' });
    const num = el('span', { class: 'gs-pe__num' });
    const badge = el('span', { class: 'gs-pe__badge', hidden: true, text: t('Removed') });
    const from = el('span', { class: 'gs-pe__from' });
    const tools = el('div', { class: 'gs-pe__tools' }, [
      toolBtn('undo', t('Turn left'), () => turn(-90, entry.id)),
      toolBtn('redo', t('Turn right'), () => turn(90, entry.id)),
      toolBtn('trash', t('Remove or restore this page'), () => toggle(entry.id)),
    ]);
    const node = el('div', { class: 'gs-pe__tile', role: 'option', tabindex: '-1', dataset: { id: entry.id } }, [
      el('div', { class: 'gs-pe__paper' }, [canvas, badge]), el('div', { class: 'gs-pe__cap' }, [num, from]), tools,
    ]);
    node.addEventListener('click', (e) => { if (e.target.closest('.gs-pe__tools')) return; choose(entry.id, e); });
    node.addEventListener('focus', () => { focusId = entry.id; });
    const tile = { node, canvas, num, badge, from, drawn: '' };
    tiles.set(entry.id, tile);
    io.observe(node);
    return tile;
  }
  function toolBtn(ic, label, onclick) {
    return el('button', { type: 'button', class: 'gs-pe__tbtn', title: label, 'aria-label': label, tabindex: '-1', onclick: (e) => { e.stopPropagation(); onclick(); } }, [icon(ic)]);
  }

  function update() {
    const pages = ctx.S.pages;
    const want = new Set(pages.map((p) => p.id));
    for (const [id, tile] of tiles) if (!want.has(id)) { io.unobserve(tile.node); tile.node.remove(); tiles.delete(id); sel.delete(id); }
    const multi = ctx.sources.all().length > 1;
    let kept = 0;
    pages.forEach((p, i) => {
      const tile = tiles.get(p.id) || makeTile(p);
      const sz = thumbSize(p);
      tile.canvas.style.width = sz.w + 'px'; tile.canvas.style.height = sz.h + 'px';
      if (!p.removed) kept++;
      tile.num.textContent = p.removed ? t('Page {n}', { n: i + 1 }) : t('Page {n}', { n: kept });
      tile.badge.hidden = !p.removed;
      tile.node.classList.toggle('is-removed', p.removed);
      tile.node.setAttribute('aria-label', `${t('Page {n}', { n: i + 1 })}${p.removed ? ', ' + t('removed') : ''}`);
      tile.from.textContent = multi ? ctx.sources.get(p.src).name : '';
      tile.from.title = tile.from.textContent;
      const key = `${p.src}:${p.page}:${p.rot}`;
      if (tile.drawn !== key) { tile.drawn = ''; if (tile.visible) enqueue(p.id); }
      if (grid.children[i] !== tile.node) grid.insertBefore(tile.node, grid.children[i] || null);
    });
    paintSel();
    if (!focusId || !tiles.has(focusId)) focusId = pages[0]?.id || null;
    for (const [id, tile] of tiles) tile.node.tabIndex = id === focusId ? 0 : -1;
  }
  function renumber() {
    let kept = 0;
    ctx.S.pages.forEach((p, i) => {
      const tile = tiles.get(p.id);
      if (!p.removed) kept++;
      if (tile) tile.num.textContent = t('Page {n}', { n: p.removed ? i + 1 : kept });
    });
  }
  function paintSel() {
    for (const [id, tile] of tiles) {
      const on = sel.has(id);
      tile.node.classList.toggle('is-sel', on);
      tile.node.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  // ---- thumbnails, a few at a time, only for tiles on screen ----
  const io = new IntersectionObserver((list) => {
    for (const e of list) {
      const tile = tiles.get(e.target.dataset.id);
      if (!tile) continue;
      tile.visible = e.isIntersecting;
      if (e.isIntersecting && tile.drawn === '') enqueue(e.target.dataset.id);
    }
  }, { root: stage, rootMargin: '400px 0px' });
  function enqueue(id) { if (!queue.includes(id)) { queue.push(id); pump(); } }
  function pump() {
    while (running < 3 && queue.length) {
      const id = queue.shift();
      const tile = tiles.get(id), entry = ctx.S.pages.find((p) => p.id === id);
      if (!tile || !entry) continue;
      const key = `${entry.src}:${entry.page}:${entry.rot}`;
      const sz = thumbSize(entry);
      running++;
      renderPage(ctx.sources.get(entry.src).doc, entry.page + 1, tile.canvas, sz.w, { rotation: entry.rot, intent: 'print', dpr: Math.min(2, window.devicePixelRatio || 1) })
        .then(() => { tile.drawn = key; })
        .catch(() => {})
        .finally(() => { running--; pump(); });
    }
  }

  // ---- choosing ----
  function choose(id, e = {}) {
    const order = ctx.S.pages.map((p) => p.id);
    if (e.shiftKey && anchorId && order.includes(anchorId)) {
      const a = order.indexOf(anchorId), b = order.indexOf(id);
      if (!(e.ctrlKey || e.metaKey)) sel.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(order[i]);
    } else if (e.ctrlKey || e.metaKey) {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      anchorId = id;
    } else {
      sel.clear(); sel.add(id); anchorId = id;
    }
    focusId = id;
    paintSel();
    ctx.repanel();
  }
  function focusTile(id, extend = false) {
    const tile = tiles.get(id);
    if (!tile) return;
    focusId = id;
    for (const [k, tl] of tiles) tl.node.tabIndex = k === id ? 0 : -1;
    tile.node.focus();
    tile.node.scrollIntoView({ block: 'nearest' });
    if (extend) choose(id, { shiftKey: true });
  }
  grid.addEventListener('keydown', (e) => {
    const order = ctx.S.pages.map((p) => p.id);
    const at = order.indexOf(focusId);
    const perRow = Math.max(1, Math.round(grid.clientWidth / (tiles.get(order[0])?.node.offsetWidth || 150)));
    const go = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -perRow, ArrowDown: perRow, Home: -1e9, End: 1e9 }[e.key];
    if (go != null) { e.preventDefault(); focusTile(order[Math.min(order.length - 1, Math.max(0, at + go))], e.shiftKey); return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); choose(focusId, e.key === ' ' ? { ctrlKey: true } : {}); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); order.forEach((id) => sel.add(id)); paintSel(); ctx.repanel(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); toggle(); return; }
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); turn(e.shiftKey ? -90 : 90); }
  });

  // ---- doing things to pages ----
  const targets = (id) => (id ? new Set(sel.has(id) ? [...sel] : [id]) : new Set(sel));
  function turn(deg, id) {
    const ids = targets(id);
    if (!ids.size) return;
    ctx.commit((S) => {
      for (const p of S.pages) if (ids.has(p.id)) { p.rot = norm(p.rot + deg); S.marks.set(p.id, (S.marks.get(p.id) || []).map((m) => turnElement(m, deg))); }
    });
  }
  function toggle(id) {
    const ids = targets(id);
    if (!ids.size) return;
    const list = ctx.S.pages.filter((p) => ids.has(p.id));
    const restore = list.every((p) => p.removed);
    if (!restore && ctx.S.pages.filter((p) => !p.removed && !ids.has(p.id)).length === 0) { ctx.toast(t('Keep at least one page.')); return; }
    ctx.commit((S) => { for (const p of S.pages) if (ids.has(p.id)) p.removed = !restore; });
  }
  function duplicate() {
    const ids = targets();
    if (!ids.size) return;
    ctx.commit((S) => {
      const out = [];
      for (const p of S.pages) {
        out.push(p);
        if (ids.has(p.id)) {
          const c = { ...p, id: ctx.newId('p'), removed: false };
          S.marks.set(c.id, (S.marks.get(p.id) || []).map((m) => ({ ...m, id: ctx.newId('m') })));
          out.push(c);
        }
      }
      S.pages = out;
    });
  }
  function shift(dir) {
    const ids = targets();
    if (!ids.size) return;
    ctx.commit((S) => {
      const a = S.pages;
      if (dir < 0) { for (let i = 1; i < a.length; i++) if (ids.has(a[i].id) && !ids.has(a[i - 1].id)) [a[i - 1], a[i]] = [a[i], a[i - 1]]; }
      else { for (let i = a.length - 2; i >= 0; i--) if (ids.has(a[i].id) && !ids.has(a[i + 1].id)) [a[i + 1], a[i]] = [a[i], a[i + 1]]; }
    });
    const tile = tiles.get(focusId);
    tile?.node.scrollIntoView({ block: 'nearest' });
  }
  async function addPages() {
    const added = await ctx.addFiles();
    if (!added.length) return;
    const entries = added.flatMap((s) => Array.from({ length: s.count }, (_, i) => ({ id: ctx.newId('p'), src: s.id, page: i, rot: 0, removed: false })));
    ctx.commit((S) => {
      const last = Math.max(-1, ...S.pages.map((p, i) => (sel.has(p.id) ? i : -1)));
      S.pages.splice(last < 0 ? S.pages.length : last + 1, 0, ...entries);
    });
    sel.clear(); entries.forEach((p) => sel.add(p.id)); paintSel(); ctx.repanel();
    ctx.toast(tn(entries.length, 'Added {n} page.', 'Added {n} pages.'));
  }
  function moveSource(id, dir) {
    ctx.commit((S) => {
      const order = [...new Set(S.pages.map((p) => p.src))];
      const i = order.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      S.pages = order.flatMap((sid) => S.pages.filter((p) => p.src === sid));   // pages of a file stay together, in their order
    });
  }
  function extract() {
    const list = picked().filter((p) => !p.removed);
    if (!list.length) return;
    ctx.saveParts([{ entries: list }]);
  }
  async function splitInto() {
    const kept = ctx.kept();
    const spec = await splitDialog(kept.length);
    if (!spec) return;
    const parts = spec.groups.map((g) => ({ entries: g.map((i) => kept[i]) }));
    ctx.saveParts(parts);
  }
  function splitDialog(n) {
    return new Promise((resolve) => {
      let mode = 'each', value = '2', problem = null, groups = splitGroups('each', n).groups;
      const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
      const modes = el('div', { class: 'gs-ed__chips' });
      const field = el('div', { class: 'gs-ed__row' });
      const note = el('p', { class: 'gs-hint', role: 'status' });
      const go = el('button', { type: 'button', class: 'gs-btn gs-btn--primary', onclick: () => groups && done({ groups }) });
      function redraw() {
        clear(modes).append(...Object.keys(SPLIT_LABELS).map((id) => el('button', { type: 'button', class: 'gs-chip' + (id === mode ? ' is-on' : ''), 'aria-pressed': id === mode ? 'true' : 'false', text: t(SPLIT_LABELS[id]), onclick: () => { mode = id; value = id === 'every' ? '2' : ''; redraw(); } })));
        clear(field);
        if (mode === 'every') field.append(el('label', { class: 'gs-label', for: 'gs-split-v', text: t('Pages in each file') }), el('input', { id: 'gs-split-v', class: 'gs-input gs-ed__num', type: 'number', min: 1, max: n, value, oninput: (e) => { value = e.target.value; measure(); } }));
        if (mode === 'ranges') field.append(el('label', { class: 'gs-label', for: 'gs-split-v', text: t('Pages, one file per range') }), el('input', { id: 'gs-split-v', class: 'gs-input', type: 'text', value, placeholder: '1-3, 4-6, 7-', oninput: (e) => { value = e.target.value; measure(); } }));
        measure();
      }
      function measure() {
        const r = splitGroups(mode, n, value);
        groups = r.groups || null;
        problem = r.error ? t(SPLIT_ERRORS[r.error]) : null;
        note.textContent = groups ? tn(groups.length, 'This makes {n} file next to the original.', 'This makes {n} files next to the original.') : problem;
        go.disabled = !groups || groups.length < 1 || (groups.length === 1 && mode !== 'ranges');
        go.textContent = groups ? t('Split into {n} files', { n: groups.length }) : t('Split');
      }
      const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
      const box = el('div', { class: 'gs-dialog gs-dialog--wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-split-t' }, [
        el('h2', { id: 'gs-split-t', text: t('Split into several files') }),
        el('p', { text: t('The pages you keep are cut up into new PDFs. The original stays as it is.') }),
        modes, field, note,
        el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn', text: t('Cancel'), onclick: () => done(null) }), go]),
      ]);
      ctx.root.append(scrim, box);
      const release = trapFocus(box, () => done(null));
      redraw();
      go.focus();
    });
  }

  // ---- the panel ----
  function renderPanel(body) {
    const list = picked();
    const kept = ctx.kept().length;
    const some = list.length > 0;
    const allRemoved = some && list.every((p) => p.removed);
    body.append(
      ...(ctx.merging && ctx.sources.all().length > 1 ? [sourcesGroup()] : []),
      el('p', { class: 'gs-pe__count', text: `${tn(kept, '{n} page', '{n} pages')}${ctx.S.pages.length > kept ? ' · ' + tn(ctx.S.pages.length - kept, '{n} removed [one]', '{n} removed') : ''}${some ? ' · ' + tn(list.length, '{n} selected [one]', '{n} selected') : ''}` }),
      group(t('Selected pages'),
        el('div', { class: 'gs-ed__row' }, [
          button(icon('undo'), t('Turn left'), () => turn(-90), { disabled: !some }),
          button(icon('redo'), t('Turn right'), () => turn(90), { disabled: !some }),
        ]),
        el('div', { class: 'gs-ed__row' }, [
          button(icon('trash'), allRemoved ? t('Restore') : t('Remove'), () => toggle(), { disabled: !some }),
          button(icon('copy'), t('Duplicate'), () => duplicate(), { disabled: !some }),
        ]),
        el('div', { class: 'gs-ed__row' }, [
          button(icon('arrowUp'), t('Earlier'), () => shift(-1), { disabled: !some, title: t('Move the selected pages one place earlier') }),
          button(icon('arrowDown'), t('Later'), () => shift(1), { disabled: !some, title: t('Move the selected pages one place later') }),
        ]),
        el('p', { class: 'gs-hint', text: some ? t('Drag a page to move it. Keys: arrows, Space to select, R to turn, Delete to remove.') : t('Click a page to select it. Ctrl or Shift selects several.') }),
      ),
      group(t('Take pages out'),
        button(icon('download'), t('Save the selected pages as a new file'), () => extract(), { disabled: !some || allRemoved, title: t('A new PDF with just these pages, next to the original') }),
        button(icon('layout'), t('Split into several files…'), () => splitInto(), { disabled: kept < 2 }),
      ),
      group(t('Add pages'),
        button(icon('plus'), t('Pages from other files…'), () => addPages(), { title: t('PDFs and photos from this document, or from your computer') }),
        el('p', { class: 'gs-hint', text: some ? t('They go in after the last selected page.') : t('They go in at the end.') }),
      ),
      ...(!ctx.merging && ctx.sources.all().length > 1 ? [sourcesGroup()] : []),
    );
  }
  function sourcesGroup() {
    const order = [...new Set(ctx.S.pages.map((p) => p.src))];
    return group(t('Files, in this order'), el('ol', { class: 'gs-pe__files' }, order.map((id, i) => {
      const s = ctx.sources.get(id);
      const n = ctx.S.pages.filter((p) => p.src === id).length;
      return el('li', { class: 'gs-pe__file' }, [
        el('span', { class: 'gs-pe__filename', text: s.name, title: s.name }), el('span', { class: 'gs-pe__filen', text: tn(n, '{n} page', '{n} pages') }),
        el('button', { type: 'button', class: 'gs-icon-btn', 'aria-label': t('Move {name} earlier', { name: s.name }), title: t('Earlier'), disabled: i === 0, onclick: () => moveSource(id, -1) }, [icon('arrowUp')]),
        el('button', { type: 'button', class: 'gs-icon-btn', 'aria-label': t('Move {name} later', { name: s.name }), title: t('Later'), disabled: i === order.length - 1, onclick: () => moveSource(id, 1) }, [icon('arrowDown')]),
      ]);
    })));
  }

  // ---- what the editor calls ----
  function ensureSortable() {
    if (sortable || !window.Sortable) return;
    sortable = window.Sortable.create(grid, {
      animation: 140, draggable: '.gs-pe__tile', filter: '.gs-pe__tools', preventOnFilter: false, ghostClass: 'is-ghost', chosenClass: 'is-chosen',
      onEnd: (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        ctx.commit((S) => { const [m] = S.pages.splice(evt.oldIndex, 1); S.pages.splice(evt.newIndex, 0, m); }, { quiet: true });
        renumber();
        ctx.repanel();
      },
    });
  }
  return {
    stage,
    renderPanel,
    refresh() { update(); },
    activate() { ensureSortable(); update(); requestAnimationFrame(() => (tiles.get(focusId)?.node.focus({ preventScroll: true }))); },
    deactivate() {},
    key(e) { return false; },
    selectedCount: () => sel.size,
    destroy() { io.disconnect(); sortable?.destroy(); },
  };
}
