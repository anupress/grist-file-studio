// The folder list on the left: every record is a folder, and with a "folder it is inside" column the folders nest. Click one to see its files
// (and those of the folders below it); drag files onto one to put them there, drag a folder onto another to move it inside. Arrow keys, Enter,
// F2 and the context-menu key work as in a file manager. The rows are drawn only as far as they are in view.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { INTERNAL_FILES } from './wall.js';
import { t, tn } from '../i18n/index.js';

const ROW_H = 30;
const OVERSCAN = 6;
/** The drag type of a folder dragged inside the widget. */
export const INTERNAL_FOLDER = 'application/x-file-studio-folder';

/**
 * @param on {onSelect(rowId|null), onToggle(rowId), onMenu(rowId|null, anchor), onNew(), onRename(rowId), onDrop(rowId, files), onSendFiles(keys, rowId, mode),
 *            onMoveFolder(rowId, parentId|0), onNest() (make the folders able to nest), onFind(text), onClose()}
 */
export function createTree(host, on) {
  const S = { rows: [], selected: null, current: null, nested: false, editable: false, total: 0, query: '', focus: 0, top: 0 };

  const title = el('h2', { class: 'gs-tree__title', id: 'gs-tree-t', text: t('Folders') });
  const add = el('button', { type: 'button', class: 'gs-icon-btn', title: t('New folder'), 'aria-label': t('New folder'), onclick: () => on.onNew() }, [icon('plus')]);
  const close = el('button', { type: 'button', class: 'gs-icon-btn gs-tree__close', title: t('Close the folder list'), 'aria-label': t('Close the folder list'), onclick: () => on.onClose() }, [icon('close')]);
  const find = el('input', { type: 'search', class: 'gs-input gs-tree__find', placeholder: t('Find a folder'), 'aria-label': t('Find a folder'), hidden: true,
    oninput: () => on.onFind(find.value) });
  const all = el('div', { class: 'gs-tree__all', role: 'treeitem', tabindex: '0', 'aria-level': '1', dataset: { root: '1' },
    onclick: () => on.onSelect(null), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on.onSelect(null); } } });
  const spacer = el('div', { class: 'gs-tree__space' });
  const list = el('div', { class: 'gs-tree__list', role: 'tree', 'aria-labelledby': 'gs-tree-t' }, [spacer]);
  const scroller = el('div', { class: 'gs-tree__scroll', tabindex: '-1' }, [all, list]);
  const nest = el('div', { class: 'gs-tree__nest', hidden: true });
  const root = el('aside', { class: 'gs-tree', 'aria-label': t('Folders') }, [
    el('div', { class: 'gs-tree__head' }, [title, el('span', { class: 'gs-spacer' }), add, close]),
    find, scroller, nest,
  ]);
  host.append(root);

  // ---- drawing -------------------------------------------------------------------------------------------------
  let nodes = new Map();   // row index -> element
  function draw() {
    const view = scroller.clientHeight || 400;
    const first = Math.max(0, Math.floor((scroller.scrollTop - all.offsetHeight) / ROW_H) - OVERSCAN);
    const last = Math.min(S.rows.length, Math.ceil((scroller.scrollTop - all.offsetHeight + view) / ROW_H) + OVERSCAN);
    for (const [i, n] of nodes) if (i < first || i >= last) { n.remove(); nodes.delete(i); }
    for (let i = first; i < last; i++) {
      let n = nodes.get(i);
      if (!n) { n = build(i); nodes.set(i, n); list.append(n); }
      n.style.top = i * ROW_H + 'px';
      refresh(n, i);
    }
  }
  function build(i) {
    const { node, depth, open, hasChildren } = S.rows[i];
    const toggle = hasChildren
      ? el('button', { type: 'button', class: 'gs-tree__toggle', tabindex: '-1', 'aria-label': open ? t('Close “{name}”', { name: node.title || t('Untitled record') }) : t('Open “{name}”', { name: node.title || t('Untitled record') }),
        onclick: (e) => { e.stopPropagation(); on.onToggle(node.rowId); } }, [icon('chevron')])
      : el('span', { class: 'gs-tree__toggle is-none', 'aria-hidden': 'true' });
    const row = el('div', {
      class: 'gs-tree__row', role: 'treeitem', tabindex: '-1', dataset: { row: String(node.rowId), i: String(i) },
      'aria-level': String(depth + 1), 'aria-expanded': hasChildren ? String(open) : null, 'aria-label': (node.title || t('Untitled record')) + ', ' + tn(node.total, '{n} file', '{n} files'),
      style: { paddingLeft: 6 + depth * 16 + 'px' },
      onclick: () => { S.focus = i; on.onSelect(node.rowId); },
      ondblclick: () => { if (hasChildren) on.onToggle(node.rowId); },
      oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); on.onMenu(node.rowId, { x: e.clientX, y: e.clientY }); },
    }, [
      toggle, icon(open ? 'folderOpen' : 'folder2'),
      el('span', { class: 'gs-tree__name', text: node.title || t('Untitled record'), title: node.title }),
      el('span', { class: 'gs-tree__n', text: node.total ? String(node.total) : '' }),
    ]);
    // dropping files, or a folder, on a folder
    row.addEventListener('dragover', (e) => dragOver(e, row, node.rowId));
    row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
    row.addEventListener('drop', (e) => dropOn(e, row, node.rowId));
    if (S.nested && S.editable) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData(INTERNAL_FOLDER, String(node.rowId)); e.dataTransfer.effectAllowed = 'move'; row.classList.add('is-dragged'); });
      row.addEventListener('dragend', () => row.classList.remove('is-dragged'));
    }
    return row;
  }
  function refresh(n, i) {
    const r = S.rows[i];
    if (!r) return;
    n.classList.toggle('is-selected', r.node.rowId === S.selected);
    n.classList.toggle('is-current', r.node.rowId === S.current);
    n.setAttribute('aria-selected', r.node.rowId === S.selected ? 'true' : 'false');
    n.tabIndex = i === S.focus ? 0 : -1;
  }

  // ---- dragging --------------------------------------------------------------------------------------------------
  const types = (e) => [...(e.dataTransfer?.types || [])];
  function dragOver(e, row, rowId) {
    const t0 = types(e);
    const ok = S.editable && (t0.includes(INTERNAL_FILES) || t0.includes('Files') || (S.nested && t0.includes(INTERNAL_FOLDER)));
    if (!ok) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = t0.includes(INTERNAL_FOLDER) ? 'move' : t0.includes(INTERNAL_FILES) && !(e.ctrlKey || e.altKey) ? 'move' : 'copy';
    row.classList.add('is-drop-target');
  }
  function dropOn(e, row, rowId) {
    row.classList.remove('is-drop-target');
    const t0 = types(e);
    if (!S.editable) return;
    if (t0.includes(INTERNAL_FOLDER)) {
      e.preventDefault(); e.stopPropagation();
      on.onMoveFolder(Number(e.dataTransfer.getData(INTERNAL_FOLDER)), rowId);
    } else if (t0.includes(INTERNAL_FILES)) {
      e.preventDefault(); e.stopPropagation();
      let keys = [];
      try { keys = JSON.parse(e.dataTransfer.getData(INTERNAL_FILES) || '[]'); } catch { /* not ours */ }
      if (keys.length) on.onSendFiles(keys, rowId, e.ctrlKey || e.altKey ? 'copy' : 'move');
    } else if (t0.includes('Files')) {
      e.preventDefault(); e.stopPropagation();
      on.onDrop(rowId, [...e.dataTransfer.files]);
    }
  }
  // the "All files" line takes a folder out to the top level
  all.addEventListener('dragover', (e) => { if (S.nested && S.editable && types(e).includes(INTERNAL_FOLDER)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; all.classList.add('is-drop-target'); } });
  all.addEventListener('dragleave', () => all.classList.remove('is-drop-target'));
  all.addEventListener('drop', (e) => { all.classList.remove('is-drop-target'); if (S.nested && S.editable && types(e).includes(INTERNAL_FOLDER)) { e.preventDefault(); on.onMoveFolder(Number(e.dataTransfer.getData(INTERNAL_FOLDER)), 0); } });
  all.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); on.onMenu(null, { x: e.clientX, y: e.clientY }); });

  // ---- keyboard ------------------------------------------------------------------------------------------------------
  function focusRow(i) {
    S.focus = Math.max(0, Math.min(S.rows.length - 1, i));
    const y = S.focus * ROW_H + all.offsetHeight;
    if (y < scroller.scrollTop) scroller.scrollTop = y;
    else if (y + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = y + ROW_H - scroller.clientHeight;
    draw();
    nodes.get(S.focus)?.focus({ preventScroll: true });
  }
  list.addEventListener('keydown', (e) => {
    const r = S.rows[S.focus];
    if (!r) return;
    const id = r.node.rowId;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(S.focus + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (S.focus === 0) all.focus(); else focusRow(S.focus - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (r.hasChildren && !r.open) on.onToggle(id); else if (r.open) focusRow(S.focus + 1); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (r.open) on.onToggle(id);
      else { for (let i = S.focus - 1; i >= 0; i--) if (S.rows[i].depth < r.depth) { focusRow(i); break; } }
    } else if (e.key === 'Home') { e.preventDefault(); focusRow(0); }
    else if (e.key === 'End') { e.preventDefault(); focusRow(S.rows.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on.onSelect(id); }
    else if (e.key === 'F2') { e.preventDefault(); on.onRename(id); }
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); on.onMenu(id, nodes.get(S.focus) || root); }
  });
  all.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && S.rows.length) { e.preventDefault(); focusRow(0); } });
  scroller.addEventListener('scroll', () => requestAnimationFrame(draw), { passive: true });
  new ResizeObserver(() => draw()).observe(scroller);

  return {
    /** data: {rows: [{node, depth, open, hasChildren}], selected, current, total (all files), nested, editable, query, count (folders), canNest} */
    set(d) {
      // nothing changed since the last time (the bar redraws often): leave the list alone
      const sig = [d.selected, d.current, d.total, d.nested, d.editable, d.count].join('|');
      if (d.rows === S.rows && sig === S.sig) return;
      S.sig = sig;
      const hadFocus = root.contains(document.activeElement);
      const rebuilt = d.rows !== S.rows;
      Object.assign(S, { rows: d.rows, selected: d.selected, current: d.current, nested: d.nested, editable: d.editable, total: d.total, query: d.query || '' });
      all.textContent = '';
      all.append(icon('gallery'), el('span', { class: 'gs-tree__name', text: t('All files') }), el('span', { class: 'gs-tree__n', text: d.total ? String(d.total) : '' }));
      all.classList.toggle('is-selected', d.selected == null);
      all.setAttribute('aria-selected', d.selected == null ? 'true' : 'false');
      add.hidden = !d.editable;
      find.hidden = d.count < 12;
      title.textContent = t('Folders');
      spacer.style.height = S.rows.length * ROW_H + 'px';
      if (rebuilt) { for (const n of nodes.values()) n.remove(); nodes = new Map(); }
      S.focus = Math.min(S.focus, Math.max(0, S.rows.length - 1));
      draw();
      if (hadFocus && rebuilt) nodes.get(S.focus)?.focus({ preventScroll: true });
      // a folder list that cannot nest says how to make it nest
      nest.hidden = d.nested || !d.editable;
      if (!nest.hidden && !nest.firstChild) {
        nest.append(el('p', { class: 'gs-hint', text: t('These folders sit side by side. To put folders inside folders, add a column that says which folder each one is inside.') }),
          el('button', { type: 'button', class: 'gs-btn', onclick: () => on.onNest() }, [icon('plus'), t('Let folders nest')]));
      }
    },
    /** Bring a folder into view (when something else chose it). */
    reveal(rowId) {
      const i = S.rows.findIndex((r) => r.node.rowId === rowId);
      if (i < 0) return;
      const y = i * ROW_H + all.offsetHeight;
      if (y < scroller.scrollTop || y + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = Math.max(0, y - scroller.clientHeight / 2);
      draw();
    },
    focus() { (S.rows.length ? nodes.get(S.focus) : all)?.focus({ preventScroll: true }) || all.focus(); },
    element: root,
    destroy() { root.remove(); },
  };
}
