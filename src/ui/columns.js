// The Columns panel: which columns hold the files, which one names a record, what a card shows, the
// layout the widget opens in, how zips are named, and the upload option. Saved in the widget's
// options for everyone; the interface language is this browser's own.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { trapFocus } from './dialog.js';
import { isFileColumn, isFieldColumn, isParentColumn } from '../model/roles.js';
import { exportPaths, unknownPlaceholders } from '../model/names.js';
import { LAYOUTS } from '../model/settings.js';
import { t, UI_LANGUAGES, storedLanguage } from '../i18n/index.js';

const LAYOUT_LABELS = { cards: 'Cards: one card per record', files: 'Files: every file', viewer: 'Viewer: the selected record, large' };
const TOKENS = ['{file}', '{n}', '{nn}', '{record}', '{date}', '{id}'];

/**
 * @param o {columns, roles, settings, editable, demo, readOnlyWhy, sample: {file, record, textOf} | null,
 *           onSave({roles, settings, language}), onAddColumn(), onClose()}
 */
export function openColumns(host, o) {
  const roles = { files: [...o.roles.files], title: o.roles.title, fields: [...o.roles.fields], parent: o.roles.parent || null };
  const s = JSON.parse(JSON.stringify(o.settings));
  let language = storedLanguage();
  const fileCols = o.columns.filter(isFileColumn);
  const fieldCols = o.columns.filter(isFieldColumn);
  const parentCols = o.columns.filter((c) => isParentColumn(c, o.tableId));

  const close = () => { release(); scrim.remove(); drawer.remove(); o.onClose?.(); };
  const scrim = el('div', { class: 'gs-scrim', onclick: () => close() });
  const body = el('div', { class: 'gs-drawer__body' });
  const save = el('button', { type: 'button', class: 'gs-btn gs-btn--primary', text: o.demo ? t('Apply') : t('Save'), disabled: !o.editable && !o.demo,
    title: !o.editable && !o.demo ? o.readOnlyWhy || '' : null,
    onclick: () => { o.onSave({ roles, settings: s, language }); close(); } });
  const drawer = el('div', { class: 'gs-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-cols-t' }, [
    el('div', { class: 'gs-drawer__head' }, [
      el('h2', { id: 'gs-cols-t', text: t('Columns and options') }),
      el('button', { type: 'button', class: 'gs-icon-btn', 'aria-label': t('Close'), onclick: () => close() }, [icon('close')]),
    ]),
    body,
    el('div', { class: 'gs-drawer__foot' }, [
      !o.editable && !o.demo ? el('span', { class: 'gs-hint', text: o.readOnlyWhy || '' }) : null,
      el('span', { class: 'gs-spacer' }),
      el('button', { type: 'button', class: 'gs-btn', text: t('Cancel'), onclick: () => close() }),
      save,
    ]),
  ]);

  const check = (label, on, change, extra = {}) => el('label', { class: 'gs-check', ...extra }, [el('input', { type: 'checkbox', checked: on, onchange: (e) => change(e.target.checked) }), label]);
  const select = (id, label, options, current, change, hint = null) => el('div', { class: 'gs-field' }, [
    el('label', { for: id, text: label }),
    el('select', { id, class: 'gs-input', onchange: (e) => change(e.target.value) }, options.map(([v, text]) => el('option', { value: v, text, selected: v === current }))),
    hint ? el('p', { class: 'gs-hint', text: hint }) : null,
  ]);

  function patternField(id, label, value, change, hint) {
    const input = el('input', { id, class: 'gs-input', value, spellcheck: false });
    const warn = el('p', { class: 'gs-warn', hidden: true });
    const preview = el('div', { class: 'gs-preview', 'aria-live': 'polite' });
    const refresh = () => {
      change(input.value);
      const bad = unknownPlaceholders(input.value, o.columns);
      warn.hidden = !bad.length;
      warn.textContent = bad.length ? t('No column called {names}', { names: bad.map((b) => '{' + b + '}').join(', ') }) : '';
      if (o.sample) {
        const [x] = exportPaths([{ file: o.sample.file, record: o.sample.record, n: 1 }], {
          pattern: s.zip.pattern, folders: s.zip.folders, folderPattern: s.zip.folderPattern, columns: o.columns, textOf: o.sample.textOf,
        });
        preview.textContent = t('For example: {path}', { path: x.path });
      }
    };
    input.addEventListener('input', refresh);
    const tokens = el('div', { class: 'gs-tokens' }, [
      ...TOKENS,
      ...fieldCols.slice(0, 8).map((c) => '{' + c.id + '}'),
    ].map((tok) => el('button', { type: 'button', class: 'gs-token', text: tok, title: t('Insert'), onclick: () => {
      const at = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, at) + tok + input.value.slice(input.selectionEnd ?? at);
      input.focus();
      input.setSelectionRange(at + tok.length, at + tok.length);
      refresh();
    } })));
    setTimeout(refresh);
    return el('div', { class: 'gs-field' }, [el('label', { for: id, text: label }), input, tokens, warn, hint ? el('p', { class: 'gs-hint', text: hint }) : null, preview]);
  }

  function render() {
    clear(body);
    // ---- files
    body.append(el('h3', { text: t('Files') }));
    if (!fileCols.length) {
      body.append(
        el('p', { class: 'gs-hint', text: t('This table has no Attachments column yet. Add one to keep files in it.') }),
        o.editable ? el('button', { type: 'button', class: 'gs-btn', onclick: () => { close(); o.onAddColumn(); } }, [icon('plus'), t('Add an Attachments column')]) : null,
      );
    } else {
      body.append(el('div', { class: 'gs-field' }, [
        el('span', { class: 'gs-field__label', text: t('Show files from') }),
        el('div', { class: 'gs-checks' }, fileCols.map((c) => check(c.label + (c.isFormula ? ' ' + t('(formula, read only)') : ''), roles.files.includes(c.id), (on) => {
          roles.files = on ? fileCols.map((x) => x.id).filter((id) => id === c.id || roles.files.includes(id)) : roles.files.filter((x) => x !== c.id);
        }))),
        el('p', { class: 'gs-hint', text: t('New files go into the first column ticked.') }),
      ]));
    }
    // ---- records
    body.append(el('h3', { text: t('Records') }));
    body.append(select('gs-c-title', t('Name of a record'), [['', t('(none)')], ...fieldCols.map((c) => [c.id, c.label])], roles.title || '', (v) => { roles.title = v || null; }, t('Shown on cards and headings. New records made from files get the file name here.')));
    body.append(select('gs-c-parent', t('Folder it is inside'), [['', t('(none: folders do not nest)')], ...parentCols.map((c) => [c.id, c.label])], roles.parent || '', (v) => { roles.parent = v || null; },
      parentCols.length ? t('A Reference column to this table that says which record a record is inside. It makes the folder list on the left show folders inside folders.') : t('This table has no Reference column to itself yet. The Folders list on the left can add one (named Parent).')));
    body.append(el('div', { class: 'gs-field' }, [
      el('span', { class: 'gs-field__label', text: t('Card fields (up to 4)') }),
      el('div', { class: 'gs-checks' }, fieldCols.filter((c) => c.id !== roles.title).map((c) => {
        const box = check(c.label, roles.fields.includes(c.id), (on) => {
          if (on && roles.fields.length >= 4) { box.querySelector('input').checked = false; return; }
          roles.fields = on ? fieldCols.map((x) => x.id).filter((id) => id === c.id || roles.fields.includes(id)) : roles.fields.filter((x) => x !== c.id);
        });
        return box;
      })),
    ]));
    // ---- layout
    body.append(el('h3', { text: t('Layout') }));
    body.append(select('gs-c-layout', t('Opens in'), LAYOUTS.map((id) => [id, t(LAYOUT_LABELS[id])]), s.layout, (v) => { s.layout = v; }, t('Everyone sees this first; each person can switch, and their browser remembers.')));
    // ---- zip
    body.append(el('h3', { id: 'gs-c-downloads', text: t('Downloads') }));
    body.append(patternField('gs-c-pattern', t('File names in a zip'), s.zip.pattern, (v) => { s.zip.pattern = v || '{file}'; },
      t('Columns in braces are filled in for each file. The extension is always the file’s own.')));
    body.append(el('div', { class: 'gs-field' }, [
      check(t('A folder for each record'), s.zip.folders, (on) => { s.zip.folders = on; render(); }),
    ]));
    if (s.zip.folders) body.append(patternField('gs-c-folder', t('Folder names'), s.zip.folderPattern, (v) => { s.zip.folderPattern = v || '{record}'; }));
    body.append(el('div', { class: 'gs-field' }, [check(t('Add files.csv: which file came from which record'), s.zip.manifest, (on) => { s.zip.manifest = on; })]));
    // ---- uploads
    body.append(el('h3', { text: t('Uploads') }));
    body.append(el('div', { class: 'gs-field' }, [
      check(t('Shrink large photos before uploading'), s.upload.shrink, (on) => { s.upload.shrink = on; }),
      el('p', { class: 'gs-hint', text: t('Longest side {px} px. Saves space in the document, and also removes the location and camera data stored in photos.', { px: s.upload.maxSide }) }),
    ]));
    // ---- language (this browser)
    body.append(el('h3', { text: t('This browser') }));
    body.append(select('gs-c-lang', t('Language of the widget'), UI_LANGUAGES.map((l) => [l.id, l.id === 'auto' ? t('Automatic') : l.label]), language, (v) => { language = v; }));
  }

  render();
  host.append(scrim, drawer);
  const release = trapFocus(drawer, () => close());
  drawer.querySelector('input, select, button')?.focus({ preventScroll: true });
  // a menu item that is about one section (how zip files are named) lands on it
  if (typeof o.scrollTo === 'string') drawer.querySelector('#' + o.scrollTo)?.scrollIntoView({ block: 'start' });
  return close;
}
