// Choose a record: where "Copy to…" and "Move to…" send files. A search box over the records' titles
// and fields, arrow keys and Enter, the records with their file counts.

import { el, clear } from '../core/util.js';
import { trapFocus } from './dialog.js';
import { matcher } from '../model/files.js';
import { t, tn } from '../i18n/index.js';

/**
 * @param o {title, body, records: [{rowId, title, fields, files}], exclude: Set<rowId>, ok}
 * @returns Promise<rowId | null>
 */
export function pickRecord(host, { title, body = '', records, exclude = new Set(), ok }) {
  return new Promise((resolve) => {
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const choices = records.filter((r) => !exclude.has(r.rowId));
    let shown = choices, at = 0;
    const list = el('div', { class: 'gs-pick__list', role: 'listbox', 'aria-label': t('Records') });
    const search = el('input', { type: 'search', class: 'gs-input', placeholder: t('Search records'), 'aria-label': t('Search records'),
      oninput: () => draw(), onkeydown: (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); mark(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); mark(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) done(shown[at].rowId); }
      } });
    function mark() {
      [...list.children].forEach((n, k) => { n.classList.toggle('is-on', k === at); n.setAttribute('aria-selected', k === at ? 'true' : 'false'); });
      list.children[at]?.scrollIntoView({ block: 'nearest' });
    }
    function draw() {
      const m = matcher(search.value);
      shown = (m ? choices.filter((r) => m(r.title, ...r.fields.map((f) => f.text))) : choices).slice(0, 200);
      at = 0;
      clear(list).append(...shown.map((r) => el('button', { type: 'button', class: 'gs-pick__item', role: 'option', onclick: () => done(r.rowId) }, [
        el('span', { class: 'gs-pick__title', text: r.title || t('Untitled record') }),
        el('span', { class: 'gs-pick__meta', text: [r.fields.find((f) => f.text)?.text, tn(r.files.length, '{n} file', '{n} files')].filter(Boolean).join(' · ') }),
      ])));
      if (!shown.length) list.append(el('p', { class: 'gs-hint', text: t('No record matches.') }));
      mark();
    }
    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
    const box = el('div', { class: 'gs-dialog gs-pick', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-pick-t' }, [
      el('h2', { id: 'gs-pick-t', text: title }),
      body ? el('p', { text: body }) : null,
      search, list,
      el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn', text: t('Cancel'), onclick: () => done(null) })]),
    ]);
    host.append(scrim, box);
    const release = trapFocus(box, () => done(null));
    draw();
    search.focus();
  });
}
