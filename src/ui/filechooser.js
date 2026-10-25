// Choose files to add pages from: the PDFs and photos already in this document, and files from the
// computer. Used by "Add pages…" in the PDF editor.

import { el } from '../core/util.js';
import { trapFocus } from './dialog.js';
import { matcher } from '../model/files.js';
import { sizeText } from '../model/kinds.js';
import { t, tn } from '../i18n/index.js';

/**
 * @param o {title, body, candidates: [{key, name, ext, size, where}], accept}
 * @returns Promise<{picked: candidate[], files: File[]} | null>
 */
export function chooseFiles(host, { title, body = '', candidates, accept = '.pdf,application/pdf,image/*', ok = t('Add') }) {
  return new Promise((resolve) => {
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const chosen = new Set();
    let local = [];
    const list = el('div', { class: 'gs-pick__list gs-fc__list', role: 'group', 'aria-label': title });
    const search = el('input', { type: 'search', class: 'gs-input', placeholder: t('Search files'), 'aria-label': t('Search files'), oninput: () => draw() });
    const okBtn = el('button', { type: 'button', class: 'gs-btn gs-btn--primary', disabled: true, onclick: () => done({ picked: candidates.filter((c) => chosen.has(c.key)), files: local }) });
    const fromPc = el('input', { type: 'file', multiple: true, accept, hidden: true, onchange: (e) => { local = [...local, ...e.target.files]; e.target.value = ''; localNote.textContent = tn(local.length, '{n} file from your computer', '{n} files from your computer'); sync(); } });
    const localNote = el('span', { class: 'gs-label' });
    function sync() { const n = chosen.size + local.length; okBtn.disabled = !n; okBtn.textContent = n ? `${ok} (${n})` : ok; }
    function draw() {
      const m = matcher(search.value);   // null while nothing is typed
      const shown = m ? candidates.filter((c) => m(c.name, c.where)) : candidates;
      list.replaceChildren(...(shown.length ? shown.map((c) => el('label', { class: 'gs-fc__item' }, [
        el('input', { type: 'checkbox', checked: chosen.has(c.key), onchange: (e) => { e.target.checked ? chosen.add(c.key) : chosen.delete(c.key); sync(); } }),
        el('span', { class: 'gs-fc__name', text: c.name }),
        el('span', { class: 'gs-fc__meta', text: `${c.where ? c.where + ' · ' : ''}${sizeText(c.size)}` }),
      ])) : [el('p', { class: 'gs-places__none', text: candidates.length ? t('No file matches.') : t('There are no other PDFs or pictures in this document.') })]));
    }
    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
    const box = el('div', { class: 'gs-dialog gs-dialog--wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-fc-t' }, [
      el('h2', { id: 'gs-fc-t', text: title }),
      body ? el('p', { text: body }) : null,
      candidates.length > 6 ? search : null,
      list,
      el('div', { class: 'gs-ed__row' }, [
        el('button', { type: 'button', class: 'gs-btn', text: t('From your computer…'), onclick: () => fromPc.click() }), localNote, fromPc,
      ]),
      el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn', text: t('Cancel'), onclick: () => done(null) }), okBtn]),
    ]);
    host.append(scrim, box);
    const release = trapFocus(box, () => done(null));
    draw(); sync();
    (candidates.length > 6 ? search : box.querySelector('button')).focus();
  });
}
