// The Viewer layout: one record's files, large, with a filmstrip to arrange them.
//
// It follows the record Grist points at: the cursor of its own section (when it is linked as
// "Same record" to a table, that is the table's selected row) or a card clicked here. Next to a table,
// this is the "attachment viewer" people have asked Grist for since 2022.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { showFile } from './stage.js';
import { renderFace } from './face.js';
import { t, tn } from '../i18n/index.js';

/**
 * @param on {onStep(dir), onOpen(file, list), onAdd(rowId), onDrop(rowId, files), onReorder(file, toIndex),
 *            onMenu(file, anchor), onDownload(file), onZip(rowId), onReport(rowId), onSelect(rowId)}
 */
export function createViewer(host, { source, thumbs, culture }, on) {
  const title = el('span', { class: 'gs-viewer__title' });
  const pos = el('span', { class: 'gs-viewer__pos' });
  const prevRec = el('button', { type: 'button', class: 'gs-icon-btn', title: t('Previous record'), 'aria-label': t('Previous record'), onclick: () => on.onStep(-1) }, [icon('arrowLeft')]);
  const nextRec = el('button', { type: 'button', class: 'gs-icon-btn', title: t('Next record'), 'aria-label': t('Next record'), onclick: () => on.onStep(1) }, [icon('arrowRight')]);
  const actions = el('div', { class: 'gs-viewer__actions' });
  const head = el('div', { class: 'gs-viewer__head' }, [el('span', { class: 'gs-viewer__nav' }, [prevRec, nextRec]), title, pos, actions]);
  const stage = el('div', { class: 'gs-viewer__stage' });
  const strip = el('div', { class: 'gs-strip', role: 'listbox', 'aria-label': t('Files of this record'), 'aria-orientation': 'horizontal' });
  const root = el('div', { class: 'gs-viewer', tabindex: '-1' }, [head, stage, strip]);
  clear(host).append(root);

  const S = { rec: null, files: [], i: 0, editable: false, view: null, key: null, sortable: null, releases: [] };

  function show(i) {
    S.i = Math.max(0, Math.min(S.files.length - 1, i));
    S.view?.destroy();
    S.view = null;
    const f = S.files[S.i];
    S.key = f?.key || null;
    if (!f) {
      clear(stage).append(el('div', { class: 'gs-empty' }, [
        el('h2', { text: t('No files yet') }),
        el('p', { text: S.editable ? t('Drop files here, paste a screenshot, or use Add files.') : t('This record has no files.') }),
        S.editable ? el('div', { class: 'gs-empty__actions' }, [el('button', { type: 'button', class: 'gs-btn gs-btn--primary', onclick: () => on.onAdd(S.rec.rowId) }, [icon('plus'), t('Add files')])]) : null,
      ]));
    } else {
      S.view = showFile(stage, f, { source, thumbs, culture, onSwipe: (d) => show(S.i + d), onDownload: () => on.onDownload(f) });
    }
    [...strip.querySelectorAll('.gs-strip__item')].forEach((n, k) => { n.classList.toggle('is-on', k === S.i); n.setAttribute('aria-selected', k === S.i ? 'true' : 'false'); });
    strip.querySelector('.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderStrip() {
    S.releases.splice(0).forEach((r) => r());
    S.sortable?.destroy();
    S.sortable = null;
    clear(strip);
    S.files.forEach((f, k) => {
      const item = el('button', { type: 'button', class: 'gs-strip__item', role: 'option', title: f.name, 'aria-label': f.name, dataset: { key: f.key },
        onclick: () => show(k), ondblclick: () => on.onOpen(f, S.files),
        oncontextmenu: (e) => { e.preventDefault(); on.onMenu(f, item); } });
      S.releases.push(renderFace(item, f, { thumbs, cssPx: 76, tags: false }));
      if (k === 0 && S.files.length > 1 && (f.kind === 'image' || f.kind === 'pdf' || f.kind === 'video')) item.append(el('span', { class: 'gs-strip__cover', text: t('Cover') }));
      strip.append(item);
    });
    if (S.editable && S.rec) strip.append(el('button', { type: 'button', class: 'gs-strip__add', onclick: () => on.onAdd(S.rec.rowId) }, [t('+ Add')]));
    // Drag to reorder, within one column: an Attachments cell is one ordered list.
    if (S.editable && window.Sortable && S.files.length > 1 && !S.files.some((f) => f.readOnly)) {
      S.sortable = window.Sortable.create(strip, {
        animation: 140, draggable: '.gs-strip__item', delay: 120, delayOnTouchOnly: true,
        onEnd: (e) => {
          if (e.oldDraggableIndex === e.newDraggableIndex) return;
          const f = S.files[e.oldDraggableIndex];
          const target = S.files[e.newDraggableIndex];
          if (!f || !target || target.col !== f.col) { renderStrip(); show(S.i); return; }
          on.onReorder(f, target.index);
        },
      });
    }
  }

  function renderActions() {
    clear(actions);
    if (!S.rec) return;
    const f = S.files[S.i];
    if (f) {
      actions.append(
        el('button', { type: 'button', class: 'gs-btn', title: t('Open large (Enter)'), onclick: () => on.onOpen(S.files[S.i], S.files) }, [icon('expand'), t('Open')]),
        el('button', { type: 'button', class: 'gs-btn', title: t('Download this file'), onclick: () => on.onDownload(S.files[S.i]) }, [icon('download2')]),
        el('button', { type: 'button', class: 'gs-btn', title: t('More'), 'aria-label': t('More'), onclick: (e) => on.onMenu(S.files[S.i], e.currentTarget) }, [icon('menu')]),
      );
    }
    if (S.files.length > 1) actions.append(el('button', { type: 'button', class: 'gs-btn', title: t('All files of this record as one zip'), onclick: () => on.onZip(S.rec.rowId) }, [icon('archive2'), t('Zip')]));
    if (on.onReport && S.files.some((x) => x.kind === 'image')) actions.append(el('button', { type: 'button', class: 'gs-btn', dataset: { role: 'report' }, title: t('The photos of this record on pages, as a PDF'), onclick: () => on.onReport(S.rec.rowId) }, [icon('file2'), t('Report')]));
    // No Add files here: the bar's own adds to this record, and the filmstrip ends in an Add tile.
  }

  // dropping files on the viewer adds them to its record
  root.addEventListener('dragover', (e) => {
    if (!S.editable || !S.rec || ![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    root.classList.add('is-drop-target');
    stage.dataset.drop = t('Drop to add to {name}', { name: S.rec.title || t('this record') });
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('is-drop-target'); });
  root.addEventListener('drop', (e) => {
    if (!S.editable || !S.rec || !e.dataTransfer?.files?.length) return;
    e.preventDefault(); e.stopPropagation();
    root.classList.remove('is-drop-target');
    on.onDrop(S.rec.rowId, [...e.dataTransfer.files]);
  });
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, .gs-menu, .gs-dialog, .gs-lightbox, iframe, video, audio')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); show(S.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(S.i - 1); }
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); on.onStep(1); }
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); on.onStep(-1); }
    else if (e.key === 'Enter' && S.files[S.i]) { e.preventDefault(); on.onOpen(S.files[S.i], S.files); }
  });
  stage.addEventListener('dblclick', (e) => { if (S.files[S.i] && !e.defaultPrevented && (S.files[S.i].kind === 'text' || S.files[S.i].kind === 'other')) on.onOpen(S.files[S.i], S.files); });

  return {
    /**
     * Show a record. rec null = nothing selected. pos: {index, count} of the record among the shown ones.
     * Keeps the same file when the record is the same (an edit came back from Grist).
     */
    set(rec, { editable, index, count }) {
      const same = S.rec && rec && S.rec.rowId === rec.rowId;
      S.rec = rec;
      S.editable = editable;
      S.files = rec ? rec.files : [];
      prevRec.disabled = !rec || index <= 0;
      nextRec.disabled = !rec || index >= count - 1;
      if (!rec) {
        title.textContent = '';
        pos.textContent = '';
        S.view?.destroy(); S.view = null;
        S.releases.splice(0).forEach((r) => r());
        clear(strip);
        clear(stage).append(el('div', { class: 'gs-empty' }, [
          el('h2', { text: count ? t('Pick a record') : t('No records') }),
          el('p', { text: count ? t('Select a row in a table linked to this widget, or step through the records with the arrows.') : t('This table has no records to show.') }),
        ]));
        clear(actions);
        return;
      }
      title.textContent = rec.title || t('Untitled record');
      pos.textContent = t('{i} of {n}', { i: index + 1, n: count }) + ' · ' + tn(rec.files.length, '{n} file', '{n} files');
      const keep = same ? S.files.findIndex((f) => f.key === S.key || (S.key && f.attId === Number(S.key.split(':')[3]))) : -1;
      renderStrip();
      renderActions();
      if (same && keep >= 0 && S.view && S.files[keep]?.key === S.key) { S.i = keep; [...strip.querySelectorAll('.gs-strip__item')].forEach((n, k) => n.classList.toggle('is-on', k === keep)); return; }
      show(keep >= 0 ? keep : 0);
    },
    current: () => S.files[S.i] || null,
    focus: () => root.focus(),
    destroy() { S.view?.destroy(); S.sortable?.destroy(); S.releases.splice(0).forEach((r) => r()); root.remove(); },
  };
}
