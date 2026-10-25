// The command palette box (Ctrl+K): a field, and under it the commands, folders and files that fit what was typed.
// Arrows choose, Enter runs, Esc closes. The items come from the caller as a function (read when the box opens).

import { el, clear } from '../core/util.js';
import { trapFocus } from './dialog.js';
import { rankPalette } from '../model/palette.js';
import { t } from '../i18n/index.js';

const groupName = (g) => ({ commands: t('Commands'), folders: t('Folders'), files: t('Files') }[g]);

/**
 * @param o {items: () => [{group, label, hint?, words?, keys?, disabled?, run()}]}
 */
export function openPalette(host, o) {
  const items = o.items();
  let flat = [], at = 0;
  const close = () => { release(); scrim.remove(); box.remove(); };
  const input = el('input', { type: 'text', class: 'gs-input gs-pal__input', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'gs-pal-list', 'aria-autocomplete': 'list',
    placeholder: t('Find a file, a folder or a command'), 'aria-label': t('Find a file, a folder or a command'), spellcheck: false, autocomplete: 'off' });
  const list = el('div', { class: 'gs-pal__list', id: 'gs-pal-list', role: 'listbox' });
  const status = el('div', { class: 'gs-sr', role: 'status' });

  function draw() {
    const groups = rankPalette(items, input.value);
    flat = groups.flatMap((g) => g.items);
    at = Math.min(at, Math.max(0, flat.length - 1));
    clear(list);
    let n = 0;
    for (const g of groups) {
      list.append(el('div', { class: 'gs-pal__group', role: 'presentation', text: groupName(g.group) }));
      for (const it of g.items) {
        const k = n++;
        list.append(el('div', { class: 'gs-pal__item' + (it.disabled ? ' is-off' : ''), id: 'gs-pal-' + k, role: 'option', 'aria-selected': k === at ? 'true' : 'false', 'aria-disabled': it.disabled ? 'true' : null,
          dataset: { i: String(k) }, onclick: () => run(it), onmousemove: () => { if (at !== k) { at = k; mark(); } } }, [
          el('span', { class: 'gs-pal__label', text: it.label }),
          it.hint ? el('span', { class: 'gs-pal__hint', text: it.hint }) : null,
          it.keys ? el('kbd', { class: 'gs-pal__keys', text: it.keys }) : null,
        ]));
      }
    }
    if (!flat.length) list.append(el('div', { class: 'gs-pal__none', text: input.value.trim() ? t('Nothing matches “{q}”.', { q: input.value.trim() }) : t('Type to find a file, a folder or a command.') }));
    mark();
    status.textContent = flat.length ? '' : t('No matches');
  }
  function mark() {
    for (const n of list.querySelectorAll('.gs-pal__item')) n.setAttribute('aria-selected', Number(n.dataset.i) === at ? 'true' : 'false');
    const cur = list.querySelector(`#gs-pal-${at}`);
    input.setAttribute('aria-activedescendant', cur ? cur.id : '');
    cur?.scrollIntoView({ block: 'nearest' });
  }
  function run(it) {
    if (!it || it.disabled) return;
    close();
    it.run();
  }
  input.addEventListener('input', () => { at = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) { at = (at + 1) % flat.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) { at = (at - 1 + flat.length) % flat.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[at]); }
  });

  const scrim = el('div', { class: 'gs-scrim', onclick: () => close() });
  const box = el('div', { class: 'gs-dialog gs-pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Find a file, a folder or a command') }, [input, list, el('div', { class: 'gs-pal__foot', text: t('Arrows to choose, Enter to run, Esc to close') }), status]);
  host.append(scrim, box);
  const release = trapFocus(box, () => close());
  draw();
  input.focus();
}
