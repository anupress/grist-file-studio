// The keyboard sheet (?): every shortcut, by where it works.

import { el } from '../core/util.js';
import { trapFocus } from './dialog.js';
import { t } from '../i18n/index.js';

// A function, so every label passes through t() in the language chosen when the sheet opens.
const keys = () => [
  [t('Everywhere'), [
    [['/'], t('Search')],
    [[t('Ctrl'), 'K'], t('Find a file, a folder or a command')],
    [['Alt+1', 'Alt+2', 'Alt+3'], t('Cards, Files, Viewer')],
    [[t('Ctrl'), 'V'], t('Paste a picture, or the files cut or copied, into the selected record')],
    [[t('Ctrl'), 'X', 'C'], t('Cut or copy the marked files (Files layout)')],
    [[t('Ctrl'), 'Z'], t('Undo')],
    [['?'], t('This list')],
  ]],
  [t('Cards and files'), [
    [['← → ↑ ↓'], t('Move')],
    [['Enter'], t('Open the file, or show the record in the Viewer')],
    [[t('Space')], t('Mark a file (with Shift: everything up to it)')],
    [[t('Ctrl'), 'A'], t('Mark all the files shown (Files layout)')],
    [['F2'], t('Rename the file')],
    [[t('Delete')], t('Remove the file from its record')],
    [['Esc'], t('Unmark all')],
  ]],
  [t('Lightbox and Viewer'), [
    [['← →'], t('Previous and next file')],
    [['↑ ↓'], t('Previous and next record (Viewer)')],
    [['+ − 0 1'], t('Zoom in, out, fit, 100 %')],
    [['R'], t('Rotate the view')],
    [['I'], t('Details')],
    [['S'], t('Start or stop the slideshow')],
    [['D'], t('Download')],
    [['Esc'], t('Close')],
  ]],
];

export function openKeys(host) {
  const close = () => { release(); scrim.remove(); box.remove(); };
  const scrim = el('div', { class: 'gs-scrim', onclick: () => close() });
  const box = el('div', { class: 'gs-dialog gs-dialog--keys', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-keys-t' }, [
    el('h2', { id: 'gs-keys-t', text: t('Keyboard shortcuts') }),
    ...keys().flatMap(([group, rows]) => [
      el('h3', { class: 'gs-keys__group', text: group }),
      el('dl', { class: 'gs-keys' }, rows.flatMap(([combo, what]) => [
        el('dt', {}, combo.flatMap((k, i) => (i ? [' ', el('kbd', { text: k })] : [el('kbd', { text: k })]))),
        el('dd', { text: what }),
      ])),
    ]),
    el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn gs-btn--primary', text: t('Close'), onclick: () => close() })]),
  ]);
  host.append(scrim, box);
  const release = trapFocus(box, () => close());
  box.querySelector('button').focus({ preventScroll: true });   // the list opens at its top, not scrolled down to the Close button
}
