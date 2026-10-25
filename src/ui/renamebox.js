// Rename many files at once by a pattern built from the columns ("{Invoice} {Client} {nn}"), with a
// preview of what the first names become. One action in Grist, so Undo takes it all back.
// Asked for on the French forum: received files named by a nomenclature (forum.grist.libre.sh/t/2013).

import { el, clear } from '../core/util.js';
import { trapFocus } from './dialog.js';
import { exportPaths, unknownPlaceholders } from '../model/names.js';
import { t, tn } from '../i18n/index.js';

/**
 * @param o {items: [{file, record, n}], pattern, columns, textOf(rowId, colId)}
 * @returns Promise<[{attId, name}] | null>
 */
export function renameBox(host, { items, pattern, columns, textOf }) {
  return new Promise((resolve) => {
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const input = el('input', { id: 'gs-rn-p', class: 'gs-input', value: pattern, spellcheck: false });
    const warn = el('p', { class: 'gs-warn', hidden: true });
    const list = el('ul', { class: 'gs-renames' });
    let names = [];
    const refresh = () => {
      const bad = unknownPlaceholders(input.value, columns);
      warn.hidden = !bad.length;
      warn.textContent = bad.length ? t('No column called {names}', { names: bad.map((b) => '{' + b + '}').join(', ') }) : '';
      names = exportPaths(items, { pattern: input.value || '{file}', folders: false, columns, textOf })
        .map(({ file, path }) => ({ attId: file.attId, name: path, old: file.name }));
      clear(list).append(...names.slice(0, 4).map((x) => el('li', {}, [el('span', { class: 'gs-renames__old', text: x.old }), ' → ', el('span', { text: x.name })])));
      if (names.length > 4) list.append(el('li', { class: 'gs-renames__more', text: t('and {n} more', { n: names.length - 4 }) }));
      ok.disabled = !!bad.length;
    };
    const ok = el('button', { type: 'submit', class: 'gs-btn gs-btn--primary', text: tn(items.length, 'Rename {n} file', 'Rename {n} files') });
    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
    const box = el('form', { class: 'gs-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-rn-t',
      onsubmit: (e) => { e.preventDefault(); if (!ok.disabled) done(names.filter((x) => x.name !== x.old)); } }, [
      el('h2', { id: 'gs-rn-t', text: tn(items.length, 'Rename {n} file by a pattern', 'Rename {n} files by a pattern') }),
      el('p', { text: t('Columns in braces are filled in for each file; {n} counts the files of each record. The extension stays.') }),
      el('div', { class: 'gs-field' }, [el('label', { for: 'gs-rn-p', text: t('New names') }), input, warn]),
      list,
      el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn', text: t('Cancel'), onclick: () => done(null) }), ok]),
    ]);
    input.addEventListener('input', refresh);
    host.append(scrim, box);
    const release = trapFocus(box, () => done(null));
    refresh();
    input.focus();
    input.select();
  });
}
