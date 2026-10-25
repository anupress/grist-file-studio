// A record's every column, in a popup: what "show me the row this file is in" opens, for the widget's
// own table and for any other table that holds the file. Read-only; Open in Grist takes you to the cell.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { trapFocus } from './dialog.js';
import { cellText, attachmentIds } from '../model/values.js';
import { t, tn } from '../i18n/index.js';

/**
 * @param o {title, subtitle, row, columns, labels: {colId: Map}, fmt, fileName(attId), link, onOpenFile(attId)}
 */
export function openRowCard(host, o) {
  const close = () => { release(); scrim.remove(); box.remove(); };
  const scrim = el('div', { class: 'gs-scrim', onclick: () => close() });
  const list = el('dl', { class: 'gs-rowcard__list' });
  const value = (c) => {
    const v = o.row[c.id];
    if (c.kind === 'Attachments') {
      const ids = attachmentIds(v);
      if (!ids.length) return el('span', { class: 'gs-rowcard__empty', text: '—' });
      return el('span', { class: 'gs-rowcard__files' }, ids.map((id) => o.onOpenFile
        ? el('button', { type: 'button', class: 'gs-link', text: o.fileName(id), onclick: () => { close(); o.onOpenFile(id); } })
        : el('span', { text: o.fileName(id) })));
    }
    const text = cellText(v, c, o.labels?.[c.id], o.fmt);
    return text == null || text === '' ? el('span', { class: 'gs-rowcard__empty', text: '—' }) : el('span', { class: 'gs-rowcard__value', text });
  };
  for (const c of o.columns) list.append(el('dt', { text: c.label }), el('dd', {}, [value(c)]));
  const box = el('div', { class: 'gs-dialog gs-rowcard', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-rc-t' }, [
    el('div', { class: 'gs-rowcard__head' }, [
      el('div', {}, [el('h2', { id: 'gs-rc-t', text: o.title }), el('p', { class: 'gs-rowcard__sub', text: o.subtitle })]),
      el('button', { type: 'button', class: 'gs-icon-btn', 'aria-label': t('Close'), onclick: () => close() }, [icon('close')]),
    ]),
    list,
    el('div', { class: 'gs-dialog__foot' }, [
      o.link ? el('a', { class: 'gs-btn', href: o.link, target: '_blank', rel: 'noopener' }, [icon('external'), t('Open in Grist')]) : null,
      el('button', { type: 'button', class: 'gs-btn gs-btn--primary', text: t('Close'), onclick: () => close() }),
    ]),
  ]);
  host.append(scrim, box);
  const release = trapFocus(box, () => close());
  box.querySelector('.gs-dialog__foot .gs-btn--primary').focus();
  return close;
}

/**
 * The "Where it is" list for the details panel. places: [{tableId, tableLabel, colLabel, rowId, rowTitle, link, here}]
 * here = the place the file was opened from.
 */
export function placesList(places, { onRow }) {
  if (!places.length) return el('p', { class: 'gs-places__none', text: t('In no cell any more (removed, or hidden by access rules).') });
  return el('ul', { class: 'gs-places' }, places.map((p) => el('li', { class: 'gs-places__item' + (p.here ? ' is-here' : '') }, [
    el('div', { class: 'gs-places__where' }, [
      el('span', { class: 'gs-places__row', text: p.rowTitle || t('Row {id}', { id: p.rowId }) }),
      el('span', { class: 'gs-places__path', text: `${p.tableLabel} › ${p.colLabel}` + (p.here ? ' · ' + t('shown here') : '') }),
    ]),
    el('div', { class: 'gs-places__go' }, [
      el('button', { type: 'button', class: 'gs-icon-btn', title: t('Show the row'), 'aria-label': t('Show the row'), onclick: () => onRow(p) }, [icon('list2')]),
      p.link ? el('a', { class: 'gs-icon-btn', href: p.link, target: '_blank', rel: 'noopener', title: t('Open in Grist'), 'aria-label': t('Open in Grist') }, [icon('external')]) : null,
    ]),
  ])));
}

export const placesSummary = (n) => tn(n, 'In {n} place', 'In {n} places');

/** "Where it is" on its own, from a file's menu outside the lightbox. */
export function placesDialog(host, { title, places, onRow }) {
  const close = () => { release(); scrim.remove(); box.remove(); };
  const scrim = el('div', { class: 'gs-scrim', onclick: () => close() });
  const box = el('div', { class: 'gs-dialog gs-rowcard', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-pl-t' }, [
    el('div', { class: 'gs-rowcard__head' }, [
      el('div', {}, [el('h2', { id: 'gs-pl-t', text: title }), el('p', { class: 'gs-rowcard__sub', text: t('Where it is') + ' · ' + placesSummary(places.length) })]),
      el('button', { type: 'button', class: 'gs-icon-btn', 'aria-label': t('Close'), onclick: () => close() }, [icon('close')]),
    ]),
    el('div', { class: 'gs-rowcard__list gs-rowcard__list--places' }, [placesList(places, { onRow: (p) => { close(); onRow(p); } })]),
    el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn gs-btn--primary', text: t('Close'), onclick: () => close() })]),
  ]);
  host.append(scrim, box);
  const release = trapFocus(box, () => close());
  box.querySelector('.gs-btn--primary').focus();
}
