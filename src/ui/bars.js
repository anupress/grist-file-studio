// The two strips above the wall.
//
// The dark chrome bar is the family's: the mark, the widget's name, the mode pill (a dot plus a
// word), the layout switch and the counts on the left; Add files, Download, the keyboard sheet and
// Columns on the right. Under it, on the page's own surface, the filter bar: search, the type chips
// with their counts, sort, and the size. When files are marked, the filter bar turns into the
// marked-files bar with what can be done to them.
//
// Built once and updated in place, so the search box keeps its focus while someone types.

import { el, clear, debounce } from '../core/util.js';
import { openPopover } from './dialog.js';
import { icon } from '../core/assets/icons.js';
import { ANUPRESS_LOGO } from '../core/assets/brand-logo.js';
import { VERSION } from '../version.js';
import { t, tn } from '../i18n/index.js';

const LAYOUT_LABELS = { cards: 'Cards', files: 'Files', viewer: 'Viewer' };
const LAYOUT_ICONS = { cards: 'grid2', files: 'gallery', viewer: 'image2' };
const GROUP_LABELS = { all: 'All', image: 'Pictures', pdf: 'PDFs', video: 'Videos', audio: 'Audio', other: 'Other' };
const SORT_LABELS = { cell: 'As in the table', name: 'Name', newest: 'Newest first', oldest: 'Oldest first', largest: 'Largest first', type: 'Type' };

const seg = (label, items, onPick) => {
  // A segment with icons may drop its words on a narrow widget (the icon and the tooltip remain);
  // one without icons never does.
  const box = el('div', { class: 'gs-seg' + (items.some((x) => x[2]) ? ' gs-seg--icons' : ''), role: 'group', 'aria-label': label });
  const buttons = items.map(([id, text, ic]) => el('button', { type: 'button', class: 'gs-seg__btn', dataset: { id }, title: ic ? text : null, onclick: () => onPick(id) },
    [ic ? icon(ic) : null, el('span', { class: 'gs-seg__label', text })]));
  box.append(...buttons);
  return { box, set(cur) { for (const b of buttons) { const on = b.dataset.id === cur; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); } } };
};

/**
 * @param on {onLayout, onAdd, onDownload(anchor), onKeys, onColumns, onQuery, onGroup, onSort, onSize, onFit, onGrouped,
 *            onCaptions, onCover, onMarkAll, onMarkedZip, onMarkedRemove, onMarkedClear}
 */
export function createBars(chrome, filters, on) {
  // ---- chrome ----
  const modeDot = el('span', { class: 'gs-mode__dot', 'aria-hidden': 'true' });
  const modeText = el('span');
  const mode = el('span', { class: 'gs-mode' }, [modeDot, modeText]);
  const layouts = seg(t('Layout'), Object.entries(LAYOUT_LABELS).map(([id, label]) => [id, t(label), LAYOUT_ICONS[id]]), (id) => on.onLayout(id));
  const counts = el('span', { class: 'gs-counts', role: 'status' });
  const add = el('button', { type: 'button', class: 'gs-btn gs-btn--primary', title: t('Add files (or drop them anywhere, or paste)'), onclick: () => on.onAdd() }, [icon('plus'), el('span', { class: 'gs-wide', text: t('Add files') }), el('span', { class: 'gs-narrow', text: t('Add') })]);
  const download = el('button', { type: 'button', class: 'gs-btn', title: t('Download or zip files'), 'aria-label': t('Download'), 'aria-haspopup': 'menu', onclick: () => on.onDownload(download) }, [icon('download2'), el('span', { class: 'gs-btn__label', text: t('Download') })]);
  const keys = el('button', { type: 'button', class: 'gs-btn gs-btn--key', text: '?', title: t('Keyboard shortcuts (?)'), 'aria-label': t('Keyboard shortcuts'), onclick: () => on.onKeys() });
  const columns = el('button', { type: 'button', class: 'gs-btn', title: t('Which columns hold the files, what cards show, how zips are named'), 'aria-label': t('Columns'), onclick: () => on.onColumns() }, [icon('columns'), el('span', { class: 'gs-btn__label', text: t('Columns') })]);
  clear(chrome).append(
    el('div', { class: 'gs-bar-left' }, [
      el('a', { class: 'gs-brand', href: 'https://anupress.com', target: '_blank', rel: 'noopener', title: t('By ANUPRESS (anupress.com)') }, [
        el('img', { class: 'gs-brand__logo', src: ANUPRESS_LOGO, alt: 'ANUPRESS' }),
        el('span', { class: 'gs-brand__name', text: 'File Studio' }),
      ]),
      mode, layouts.box, counts,
    ]),
    el('div', { class: 'gs-bar-right' }, [add, download, keys, columns]),
  );

  // ---- filters ----
  const search = el('input', { type: 'search', class: 'gs-input', placeholder: t('Search'), 'aria-label': t('Search files and records'),
    oninput: debounce(() => on.onQuery(search.value), 120), onkeydown: (e) => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; on.onQuery(''); } } });
  const searchBox = el('div', { class: 'gs-search' }, [icon('filter'), search]);
  const chips = el('div', { class: 'gs-chips', role: 'group', 'aria-label': t('Show only') });
  const sort = el('select', { class: 'gs-input gs-input--inline', 'aria-label': t('Sort files'), onchange: () => on.onSort(sort.value) },
    Object.entries(SORT_LABELS).map(([id, label]) => el('option', { value: id, text: t(label) })));
  const sortBox = el('label', { class: 'gs-check' }, [el('span', { class: 'gs-label gs-sort-word', text: t('Sort') }), sort]);
  // How the wall looks (size, tile shape, headings, names; a card's cover) is set once and then left
  // alone, so it sits behind one Display button rather than on the bar.
  let last = null;
  const display = el('button', { type: 'button', class: 'gs-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: t('Size and layout of the tiles'), 'aria-label': t('Display'),
    onclick: () => openPopover(filters.parentElement, display, () => displayPanel(), { label: t('Display') }) }, [icon('sliders'), el('span', { class: 'gs-btn__label', text: t('Display') })]);
  const end = el('div', { class: 'gs-filters__end' }, [sortBox, display]);
  function displayPanel() {
    const s = last;
    const files = s.layout === 'files';
    const size = el('input', { type: 'range', id: 'gs-d-size', min: files ? '80' : '160', max: files ? '400' : '420', step: '10', value: String(s.size),
      oninput: () => on.onSize(Number(size.value)) });
    const rows = [el('div', { class: 'gs-pop__row' }, [el('label', { for: 'gs-d-size', class: 'gs-pop__label', text: t('Size') }), el('span', { class: 'gs-size' }, [icon('image2'), size, icon('image2')])])];
    if (files) {
      const fit = seg(t('Tiles'), [['justify', t('Natural')], ['square', t('Square')]], (id) => { on.onFit(id); fit.set(id); });
      fit.set(s.fit);
      rows.push(el('div', { class: 'gs-pop__row' }, [el('span', { class: 'gs-pop__label', text: t('Tiles') }), fit.box]));
      const box = (label, value, change, hint) => el('label', { class: 'gs-check', title: hint || null }, [el('input', { type: 'checkbox', checked: value, onchange: (e) => change(e.target.checked) }), label]);
      rows.push(el('div', { class: 'gs-pop__checks' }, [
        box(t('A heading for each record'), !!s.grouped, (v) => on.onGrouped(v)),
        box(t('File names under the tiles'), !!s.captions, (v) => on.onCaptions(v)),
      ]));
    } else {
      const cover = seg(t('Cover'), [['fill', t('Fill the card')], ['fit', t('Whole picture')]], (id) => { on.onCover(id); cover.set(id); });
      cover.set(s.cover);
      rows.push(el('div', { class: 'gs-pop__row' }, [el('span', { class: 'gs-pop__label', text: t('Cover') }), cover.box]));
    }
    return el('div', { class: 'gs-pop__body' }, rows);
  }
  const normal = el('div', { style: { display: 'contents' } }, [searchBox, chips, end]);

  const markedN = el('span', { class: 'gs-marked__n' });
  const marked = el('div', { style: { display: 'contents' } }, [
    markedN,
    el('button', { type: 'button', class: 'gs-btn', onclick: () => on.onMarkAll() }, [t('Mark all shown')]),
    el('button', { type: 'button', class: 'gs-btn gs-btn--primary', onclick: () => on.onMarkedZip() }, [icon('archive2'), t('Download as zip')]),
    el('button', { type: 'button', class: 'gs-btn', dataset: { role: 'rename' }, title: t('Give the marked files names built from their columns'), onclick: () => on.onMarkedRename() }, [icon('edit'), t('Rename…')]),
    el('button', { type: 'button', class: 'gs-btn', dataset: { role: 'remove' }, onclick: () => on.onMarkedRemove() }, [icon('trash'), t('Remove from records')]),
    el('span', { class: 'gs-spacer' }),
    el('button', { type: 'button', class: 'gs-btn', onclick: () => on.onMarkedClear(), title: t('Unmark all (Esc)') }, [icon('close'), t('Clear')]),
  ]);
  clear(filters).append(normal, marked);

  return {
    focusSearch() { search.focus(); search.select(); },
    /**
     * s: {level: 'full'|'bare', mode: 'live'|'ro'|'demo', readOnlyWhy, layout, editable, records, files,
     *     shown, query, group, groupCounts, sort, size, fit, grouped, captions, cover, markedCount}
     */
    update(s) {
      const level = s.level || 'full';
      mode.className = 'gs-mode is-' + s.mode;
      modeText.textContent = { live: t('Connected'), ro: t('Read only'), demo: t('Demo') }[s.mode];
      mode.title = s.mode === 'ro' && s.readOnlyWhy ? s.readOnlyWhy : 'File Studio v' + VERSION;
      layouts.box.hidden = level !== 'full';
      layouts.set(s.layout);
      counts.hidden = level !== 'full';
      counts.textContent = level === 'full' ? [tn(s.records, '{n} record', '{n} records'), tn(s.files, '{n} file', '{n} files')].join(' · ') : '';
      add.hidden = level !== 'full' || !s.editable;
      download.hidden = level !== 'full' || !s.files;
      columns.hidden = level === 'bare';
      keys.hidden = level === 'bare';

      filters.hidden = level !== 'full' || s.layout === 'viewer';
      const isMarked = s.markedCount > 0 && s.layout === 'files';
      filters.classList.toggle('gs-marked', isMarked);
      normal.style.display = isMarked ? 'none' : 'contents';
      marked.style.display = isMarked ? 'contents' : 'none';
      markedN.textContent = tn(s.markedCount, '{n} file marked', '{n} files marked');
      marked.querySelector('[data-role=remove]').hidden = !s.editable;
      marked.querySelector('[data-role=rename]').hidden = !s.editable;

      if (document.activeElement !== search && search.value !== s.query) search.value = s.query || '';
      search.setAttribute('aria-label', s.layout === 'cards' ? t('Search records') : t('Search files and records'));
      const filesLayout = s.layout === 'files';
      chips.hidden = !filesLayout;
      if (filesLayout) {
        clear(chips).append(...Object.entries(GROUP_LABELS).map(([id, label]) => {
          const n = s.groupCounts?.[id] ?? 0;
          return el('button', { type: 'button', class: 'gs-chip' + (s.group === id ? ' is-on' : ''), 'aria-pressed': s.group === id ? 'true' : 'false',
            disabled: id !== 'all' && !n && s.group !== id, onclick: () => on.onGroup(id === s.group ? 'all' : id) },
          [t(label), el('span', { class: 'gs-chip__n', text: String(n) })]);
        }));
      }
      sortBox.hidden = !filesLayout;
      sort.value = s.sort;
      last = s;
    },
  };
}
