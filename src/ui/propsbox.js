// Properties of a folder: how many files, how much space, what kinds, and the record's own fields. Read only.

import { el } from '../core/util.js';
import { trapFocus } from './dialog.js';
import { t } from '../i18n/index.js';

/**
 * @param o {name, rows: [[label, value]], parts: [{label, value, share (0..1)}] (space by type), fields: [[label, value]], note}
 * @returns Promise<void> resolved when closed
 */
export function openProps(host, o) {
  return new Promise((resolve) => {
    const done = () => { release(); scrim.remove(); box.remove(); resolve(); };
    const list = (rows) => el('dl', { class: 'gs-props' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
    const parts = (o.parts || []).length ? el('ul', { class: 'gs-props__parts', 'aria-label': t('Space by type') }, o.parts.map((p) => el('li', {}, [
      el('span', { class: 'gs-props__label', text: p.label }),
      el('span', { class: 'gs-props__value', text: p.value }),
      el('span', { class: 'gs-props__bar', 'aria-hidden': 'true', style: { '--share': String(Math.max(0.02, Math.min(1, p.share))) } }),
    ]))) : null;
    const scrim = el('div', { class: 'gs-scrim', onclick: done });
    const box = el('div', { class: 'gs-dialog gs-dialog--props', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-pr-t' }, [
      el('h2', { id: 'gs-pr-t', text: t('Properties') }),
      el('p', { class: 'gs-note__name', text: o.name, title: o.name }),
      list(o.rows),
      o.note ? el('p', { class: 'gs-props__note', text: o.note }) : null,
      parts ? el('h3', { class: 'gs-props__h', text: t('Space by type') }) : null,
      parts,
      (o.fields || []).length ? el('h3', { class: 'gs-props__h', text: t('Record') }) : null,
      (o.fields || []).length ? list(o.fields) : null,
      el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn gs-btn--primary', text: t('Close'), onclick: done })]),
    ]);
    host.append(scrim, box);
    const release = trapFocus(box, done);
    box.querySelector('button').focus();
  });
}
