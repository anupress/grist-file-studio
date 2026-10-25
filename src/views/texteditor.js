// The text editor: any text file in a code editor (CodeMirror 6, line numbers, syntax colours, search
// and replace, folding, its own undo), CSV and TSV also as a table, HTML, SVG and Markdown with a live
// preview, JSON with a check and a Format button.
//
// The file is saved back the way it came: its line endings, its byte-order mark, and for CSV its
// delimiter and quoting (media/csv.js). CodeMirror is loaded from vendor/codemirror/ the first time a
// text file is edited, never before.
//
// The previews are safe by construction: HTML runs in a sandboxed frame with no scripts and no access
// to anything; SVG is shown as a picture (an <img> never runs scripts); Markdown goes through the
// shared sanitizer.

import { el, clear, fromHTML } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { trapFocus, openMenu, confirmBox } from '../ui/dialog.js';
import { sanitizeToFragment } from '../core/security/sanitize.js';
import { detectDialect, parseCsv, toCsv, squareUp, columnName, textDialect, toFileText } from '../media/csv.js';
import { baseOf, mimeOf } from '../model/kinds.js';
import { t, tn } from '../i18n/index.js';

const GRID_MAX_ROWS = 3000;
let cmP = null;
// A plain magnifier: the shared set has only the funnel (filter) and zoom glyphs.
const SEARCH_ICON = () => fromHTML('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>');
// Task lists ("- [x] done") as ticked and empty boxes: marked writes <input> checkboxes, which the
// sanitiser removes with every other form control.
let mdReady = false;
function markdownOnce(CM) {
  if (mdReady) return;
  mdReady = true;
  CM.marked.use({ renderer: { checkbox({ checked }) { return checked ? '☑ ' : '☐ '; } } });
}
const loadCM = () => (cmP ||= import(/* @vite-ignore */ new URL('vendor/codemirror/editor.mjs', document.baseURI).href).catch((e) => { cmP = null; throw e; }));

function language(CM, ext) {
  switch (ext) {
    case 'html': case 'htm': return CM.html();
    case 'css': return CM.css();
    case 'js': case 'mjs': return CM.javascript();
    case 'ts': return CM.javascript({ typescript: true });
    case 'json': return CM.json();
    case 'md': case 'markdown': return CM.markdown();
    case 'xml': case 'svg': return CM.xml();
    case 'yaml': case 'yml': return CM.yaml();
    default: return [];
  }
}

/** Colours for the code, from the family's dark tints: readable on the dark room, never neon. */
function theme(CM) {
  const t2 = CM.tags;
  return [
    CM.EditorView.theme({
      '&': { height: '100%', backgroundColor: '#0d141b', color: '#e7eef5', fontSize: '13px' },
      '.cm-scroller': { fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace', lineHeight: '1.55' },
      '.cm-content': { caretColor: '#e7eef5', padding: '10px 0' },
      '.cm-cursor': { borderLeftColor: '#e7eef5' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(107, 165, 240, 0.32) !important' },
      '.cm-gutters': { backgroundColor: '#0d141b', color: '#7d8fa1', border: 'none', borderRight: '1px solid #1d2935' },
      '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
      '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.05)', color: '#c9d5e1' },
      '.cm-matchingBracket': { backgroundColor: 'rgba(107, 165, 240, 0.25)', outline: 'none' },
      '.cm-searchMatch': { backgroundColor: 'rgba(245, 196, 0, 0.25)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(245, 196, 0, 0.5)' },
      '.cm-panels': { backgroundColor: '#18232e', color: '#e7eef5', borderBottom: '1px solid #314253' },
      '.cm-panels input, .cm-panels button': { fontSize: '12px' },
      '.cm-textfield': { backgroundColor: '#111a22', border: '1px solid #314253', color: '#e7eef5', borderRadius: '4px' },
      '.cm-button': { backgroundImage: 'none', backgroundColor: '#1d2935', border: '1px solid #314253', color: '#e7eef5', borderRadius: '4px' },
      '.cm-foldPlaceholder': { backgroundColor: '#1d2935', border: '1px solid #314253', color: '#9fb0c2' },
    }, { dark: true }),
    CM.syntaxHighlighting(CM.HighlightStyle.define([
      { tag: [t2.keyword, t2.modifier, t2.controlKeyword, t2.operatorKeyword], color: '#b59cf5' },
      { tag: [t2.string, t2.special(t2.string), t2.regexp], color: '#5fc495' },
      { tag: [t2.number, t2.bool, t2.null, t2.atom], color: '#e9a55a' },
      { tag: [t2.comment, t2.lineComment, t2.blockComment], color: '#7d8fa1', fontStyle: 'italic' },
      { tag: [t2.tagName, t2.typeName, t2.className], color: '#7aa9f0' },
      { tag: [t2.attributeName, t2.propertyName], color: '#e9c27a' },
      { tag: [t2.heading], color: '#e7eef5', fontWeight: '700' },
      { tag: [t2.link, t2.url], color: '#6ba5f0', textDecoration: 'underline' },
      { tag: [t2.emphasis], fontStyle: 'italic' },
      { tag: [t2.strong], fontWeight: '700' },
      { tag: [t2.meta, t2.processingInstruction, t2.documentMeta], color: '#8fa1b3' },
      { tag: [t2.punctuation, t2.bracket, t2.separator], color: '#9fb0c2' },
      { tag: [t2.invalid], color: '#f0855a' },
    ])),
  ];
}

/**
 * @param o {file, source, canSave, canCopy, onSave(blob, {mode, name, pause(on)}) -> Promise<bool>}
 */
export async function openTextEditor(host, o) {
  const f = o.file;
  const isCsv = f.ext === 'csv' || f.ext === 'tsv';
  const previewKind = /^(html|htm)$/.test(f.ext) ? 'html' : f.ext === 'svg' ? 'svg' : /^(md|markdown)$/.test(f.ext) ? 'md' : null;
  const root = el('div', { class: 'gs-lightbox gs-ed gs-te', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Edit {name}', { name: f.name }), tabindex: '-1' });
  const wait = el('div', { class: 'gs-ed__wait', role: 'status' }, [t('Opening the file…')]);
  root.append(wait);
  host.append(root);

  let raw, CM, converted = false;
  try {
    const [blob, lib] = await Promise.all([o.source.blob(f), loadCM()]);
    CM = lib;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { raw = new TextDecoder('windows-1252').decode(bytes); converted = true; }
  } catch (e) {
    wait.textContent = t('The editor could not open this file: {why}', { why: String(e?.message || e) });
    setTimeout(() => root.remove(), 3000);
    return;
  }
  root.removeChild(wait);
  // The file's own habits, kept for saving. Inside the editor the text has no BOM and \n line endings.
  const dialect = isCsv ? detectDialect(raw, f.ext) : textDialect(raw);
  const text0 = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r\n?/g, '\n');
  let mode = isCsv ? 'table' : 'text';
  let rows = isCsv ? squareUp(parseCsv(text0, dialect.sep)) : null;
  if (isCsv && rows.length > GRID_MAX_ROWS) mode = 'text';
  let dirty = false;

  // ---- the bar ----
  const status = el('span', { class: 'gs-te__status', role: 'status' });
  const undoBtn = barBtn('undo', t('Undo (Ctrl+Z)'), () => (mode === 'table' ? grid.undo() : CM.undo(view)));
  const redoBtn = barBtn('redo', t('Redo (Ctrl+Y)'), () => (mode === 'table' ? grid.redo() : CM.redo(view)));
  const findBtn = barBtn(SEARCH_ICON, t('Search and replace (Ctrl+F)'), () => { if (mode === 'text') CM.openSearchPanel(view); });
  const wrapBtn = barBtn('list2', t('Wrap long lines'), () => toggleWrap());
  const modeSeg = isCsv ? el('div', { class: 'gs-seg', role: 'group', 'aria-label': t('Edit as') }, [
    el('button', { type: 'button', class: 'gs-seg__btn', dataset: { id: 'table' }, text: t('Table'), onclick: () => setMode('table') }),
    el('button', { type: 'button', class: 'gs-seg__btn', dataset: { id: 'text' }, text: t('Text'), onclick: () => setMode('text') }),
  ]) : null;
  const previewBtn = previewKind ? el('button', { type: 'button', class: 'gs-btn is-on', 'aria-pressed': 'true', 'aria-label': t('Preview'), title: t('Preview'), onclick: () => togglePreview() }, [icon('eye'), el('span', { class: 'gs-te__word', text: t('Preview') })]) : null;
  const formatBtn = f.ext === 'json' ? el('button', { type: 'button', class: 'gs-btn', onclick: () => formatJson(), title: t('Indent the JSON neatly') }, [t('Format JSON')]) : null;
  const saveBtn = el('button', { type: 'button', class: 'gs-btn gs-btn--primary gs-ed__save', 'aria-haspopup': 'menu', onclick: () => saveMenu() }, [t('Save'), icon('chevron')]);
  const bar = el('div', { class: 'gs-lb__bar' }, [
    barBtn('close', t('Close without saving (Esc)'), () => close()),
    el('span', { class: 'gs-ed__title' }, [t('Editing'), ' ', el('span', { class: 'gs-lb__name', text: f.name })]),
    status,
    el('div', { class: 'gs-lb__tools' }, [modeSeg, formatBtn, previewBtn, findBtn, wrapBtn, undoBtn, redoBtn, el('span', { class: 'gs-lb__sep' }), saveBtn]),
  ]);
  const editorHost = el('div', { class: 'gs-te__editor' });
  const gridHost = el('div', { class: 'gs-te__grid', hidden: true });
  const previewHost = el('div', { class: 'gs-te__preview', hidden: !previewKind });
  const note = el('div', { class: 'gs-te__note', hidden: !converted, text: t('This file was not UTF-8. It is shown as Windows text and will be saved as UTF-8.') });
  root.append(bar, note, el('div', { class: 'gs-te__body' }, [editorHost, gridHost, previewHost]));
  const release = trapFocus(root, null);
  function barBtn(ic, label, onclick) { return el('button', { type: 'button', class: 'gs-lb__btn', title: label, 'aria-label': label, onclick }, [typeof ic === 'string' ? icon(ic) : ic()]); }

  // ---- the code editor ----
  const wrap = new CM.Compartment();
  let wrapping = !!previewKind || f.ext === 'md' || f.ext === 'txt';
  let previewTimer = 0, switching = false;
  const view = new CM.EditorView({
    parent: editorHost,
    state: CM.EditorState.create({
      doc: isCsv && mode === 'table' ? '' : text0,
      extensions: [
        CM.lineNumbers(), CM.highlightActiveLineGutter(), CM.highlightSpecialChars(), CM.history(), CM.foldGutter(),
        CM.drawSelection(), CM.dropCursor(), CM.indentOnInput(), CM.bracketMatching(), CM.rectangularSelection(),
        CM.highlightActiveLine(), CM.highlightSelectionMatches(), CM.search({ top: true }),
        CM.keymap.of([...CM.defaultKeymap, ...CM.historyKeymap, ...CM.searchKeymap, ...CM.foldKeymap, CM.indentWithTab,
          { key: 'Mod-s', run: () => { save(defaultMode()); return true; } }]),
        language(CM, f.ext), theme(CM), wrap.of(wrapping ? CM.EditorView.lineWrapping : []),
        CM.EditorView.updateListener.of((u) => {
          if (!u.docChanged) { if (u.selectionSet) showStatus(); return; }
          if (!switching) dirty = true;
          showStatus();
          clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, 250);
        }),
      ],
    }),
  });
  function toggleWrap() {
    wrapping = !wrapping;
    view.dispatch({ effects: wrap.reconfigure(wrapping ? CM.EditorView.lineWrapping : []) });
    wrapBtn.classList.toggle('is-on', wrapping);
  }
  wrapBtn.classList.toggle('is-on', wrapping);
  const textNow = () => view.state.doc.toString();
  function showStatus() {
    if (mode === 'table') { status.textContent = `${tn(grid.rowCount(), '{n} row', '{n} rows')} · ${tn(grid.colCount(), '{n} column', '{n} columns')}` + (dirty ? ' · ' + t('not saved') : ''); return; }
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    status.textContent = t('Line {l}, column {c}', { l: line.number, c: sel.head - line.from + 1 }) + ' · ' + tn(view.state.doc.lines, '{n} line', '{n} lines') + (dirty ? ' · ' + t('not saved') : '');
  }

  // ---- previews ----
  let previewOn = !!previewKind, svgUrl = null;
  function refreshPreview() {
    if (!previewOn || !previewKind) return;
    const text = textNow();
    clear(previewHost);
    if (previewKind === 'html') {
      // sandbox with nothing allowed: no scripts, no forms, no top navigation, an opaque origin.
      previewHost.append(el('iframe', { class: 'gs-te__frame', sandbox: '', title: t('Preview'), srcdoc: text }));
      previewHost.append(el('div', { class: 'gs-te__tag', text: t('Preview · scripts do not run here') }));
    } else if (previewKind === 'svg') {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
      svgUrl = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      previewHost.append(el('div', { class: 'gs-te__svg gs-alpha' }, [el('img', { src: svgUrl, alt: t('Preview') })]));
    } else if (previewKind === 'md') {
      const doc = el('div', { class: 'gs-te__md' });
      markdownOnce(CM);
      doc.append(sanitizeToFragment(CM.marked.parse(text, { async: false })));
      previewHost.append(doc);
    }
  }
  function togglePreview() {
    previewOn = !previewOn;
    previewHost.hidden = !previewOn;
    previewBtn.classList.toggle('is-on', previewOn);
    previewBtn.setAttribute('aria-pressed', previewOn ? 'true' : 'false');
    refreshPreview();
  }
  function formatJson() {
    try {
      const pretty = JSON.stringify(JSON.parse(textNow()), null, 2) + (dialect.trailing ? '\n' : '');
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: pretty } });
      flash(t('Formatted.'));
    } catch (e) { flash(t('Not valid JSON: {why}', { why: String(e.message || e) })); }
  }
  const flashBox = el('div', { class: 'gs-media__note', hidden: true });
  root.querySelector('.gs-te__body').append(flashBox);
  let flashTimer = 0;
  function flash(text) { flashBox.textContent = text; flashBox.hidden = false; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashBox.hidden = true; }, 3500); }

  // ---- the CSV table ----
  const grid = isCsv ? createGrid(gridHost, rows, { onChange: () => { dirty = true; showStatus(); } }) : null;
  function setMode(next) {
    if (next === mode) return;
    if (next === 'text') {
      const text = toCsv(grid.rows(), { ...dialect, bom: false, eol: '\n' });
      switching = true;   // the same content in another form: not an edit
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      switching = false;
    } else {
      const parsed = squareUp(parseCsv(textNow(), dialect.sep));
      if (parsed.length > GRID_MAX_ROWS) { flash(t('Too many rows for the table ({n}). Edit it as text.', { n: parsed.length })); return; }
      grid.load(parsed);
    }
    mode = next;
    syncMode();
  }
  function syncMode() {
    editorHost.hidden = mode === 'table';
    gridHost.hidden = mode !== 'table';
    findBtn.hidden = wrapBtn.hidden = mode === 'table';
    if (modeSeg) for (const b of modeSeg.children) { const on = b.dataset.id === mode; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    showStatus();
    (mode === 'table' ? grid.focus() : view.focus());
  }

  // ---- saving ----
  const defaultMode = () => (o.canSave ? 'replace' : o.canCopy ? 'copy' : 'download');
  function contentNow() {
    if (isCsv) return mode === 'table' ? toCsv(grid.rows(), dialect) : toFileText(textNow(), dialect);
    return toFileText(textNow(), dialect);
  }
  async function save(how) {
    const text = contentNow();
    const blob = new Blob([text], { type: mimeOf(f.ext) });
    const name = how === 'copy' ? `${baseOf(f.name)} (${t('edited')})${f.ext ? '.' + f.ext : ''}` : f.name;
    const busy = el('div', { class: 'gs-ed__wait', role: 'status' }, [t('Saving…')]);
    root.append(busy);
    try {
      const done = await o.onSave(blob, { mode: how, name, pause: (on) => { busy.hidden = on; } });
      busy.remove();
      if (done) { dirty = false; close(true); }
    } catch (e) { busy.remove(); flash(t('Not saved: {why}', { why: String(e?.message || e) })); }
  }
  function saveMenu() {
    openMenu(root, saveBtn, [
      [t('Save'), () => save('replace'), { disabled: !o.canSave, hint: o.canSave ? t('The edited file takes the original’s place') : t('You cannot change this file here; save a copy or download it') }],
      [t('Save as copy'), () => save('copy'), { disabled: !o.canCopy, hint: t('Next to the original, which stays as it is') }],
      [t('Download'), () => save('download'), { hint: t('Only to your computer; the document stays as it is') }],
    ]);
  }
  async function close(force = false) {
    if (!force && dirty) {
      const ok = await confirmBox(root, { title: t('Close without saving?'), body: t('Your changes to this file will be lost.'), ok: t('Close without saving'), danger: true });
      if (!ok) return;
    }
    clearTimeout(previewTimer);
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    view.destroy(); release(); root.remove();
  }
  // Escape closes, unless something inside used it first (CodeMirror's search panel, a cell being edited).
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !e.target.closest('.cm-panels, .gs-te__cellinput, .gs-dialog, .gs-menu')) { e.preventDefault(); close(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 's' && mode === 'table') { e.preventDefault(); save(defaultMode()); }
  });

  syncMode();
  refreshPreview();
}

/**
 * A spreadsheet-style table over rows of strings: click to select, type or double-click to edit,
 * Enter and Tab to move on, arrows to move, Delete to clear, buttons to add and remove rows and
 * columns, its own undo. Only one input exists at a time, laid over the cell being edited.
 */
// Below the first (header) row, a cell that holds only a number is right-aligned so the column lines up.
const NUMBER = /^[-+\u2212]?\d[\d.,' \u00a0\u202f]*%?$/;

function createGrid(host, initial, { onChange }) {
  let data = initial.map((r) => r.slice());
  let at = { r: 0, c: 0 }, editing = null;
  const past = [], future = [];
  const scroll = el('div', { class: 'gs-te__gridscroll', tabindex: '0' });
  const tools = el('div', { class: 'gs-te__gridtools' });
  const table = el('table', { class: 'gs-te__table' });
  scroll.append(table);
  clear(host).append(tools, scroll);
  const btn = (text, title, fn) => el('button', { type: 'button', class: 'gs-btn', text, title, onclick: () => { fn(); scroll.focus(); } });
  tools.append(
    btn(t('+ Row'), t('Add a row under the selected one'), () => change(() => { data.splice(at.r + 1, 0, Array(width()).fill('')); at.r++; })),
    btn(t('+ Column'), t('Add a column right of the selected one'), () => change(() => { data.forEach((r) => r.splice(at.c + 1, 0, '')); at.c++; })),
    btn(t('− Row'), t('Remove the selected row'), () => change(() => { if (data.length > 1) data.splice(at.r, 1); at.r = Math.min(at.r, data.length - 1); })),
    btn(t('− Column'), t('Remove the selected column'), () => change(() => { if (width() > 1) data.forEach((r) => r.splice(at.c, 1)); at.c = Math.min(at.c, width() - 1); })),
  );
  const width = () => Math.max(1, ...data.map((r) => r.length));
  const snap = () => JSON.stringify(data);
  function change(fn) { const before = snap(); fn(); if (before !== snap()) { past.push(before); future.length = 0; onChange(); } render(); }
  function render() {
    const w = width();
    clear(table).append(
      el('thead', {}, [el('tr', {}, [el('th', { class: 'gs-te__corner' }), ...Array.from({ length: w }, (_, c) => el('th', { text: columnName(c), class: c === at.c ? 'is-col' : null }))])]),
      el('tbody', {}, data.map((row, r) => el('tr', { class: r === 0 ? 'is-head' : null }, [
        el('th', { text: String(r + 1), class: r === at.r ? 'is-row' : null }),
        ...Array.from({ length: w }, (_, c) => el('td', { class: cellClass(r, c, row[c]), dataset: { r: String(r), c: String(c) }, text: row[c] ?? '' })),
      ]))),
    );
    table.querySelector('td.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function cellClass(r, c, v) {
    const cls = [r === at.r && c === at.c ? 'is-on' : '', r > 0 && NUMBER.test(v ?? '') ? 'is-num' : ''].filter(Boolean).join(' ');
    return cls || null;
  }
  function cellEl(r, c) { return table.querySelector(`td[data-r="${r}"][data-c="${c}"]`); }
  function startEdit(initialText = null) {
    const td = cellEl(at.r, at.c);
    if (!td) return;
    const input = el('textarea', { class: 'gs-te__cellinput', rows: 1, spellcheck: false, value: initialText ?? data[at.r][at.c] ?? '' });
    const b = td.getBoundingClientRect(), sb = scroll.getBoundingClientRect();
    Object.assign(input.style, { left: b.left - sb.left + scroll.scrollLeft + 'px', top: b.top - sb.top + scroll.scrollTop + 'px', minWidth: b.width + 'px', height: b.height + 'px' });
    scroll.append(input);
    editing = input;
    input.focus();
    if (initialText != null) input.setSelectionRange(input.value.length, input.value.length); else input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); stopEdit(true); move(1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); stopEdit(true); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopEdit(false); }
    });
    input.addEventListener('blur', () => stopEdit(true));
  }
  function stopEdit(keep) {
    const input = editing;
    if (!input) return;
    editing = null;
    const value = input.value;
    input.remove();
    if (keep && value !== (data[at.r][at.c] ?? '')) change(() => { data[at.r][at.c] = value; });
    scroll.focus({ preventScroll: true });
  }
  function move(dr, dc) {
    at = { r: Math.max(0, Math.min(data.length - 1, at.r + dr)), c: Math.max(0, Math.min(width() - 1, at.c + dc)) };
    render();
  }
  table.addEventListener('click', (e) => { const td = e.target.closest('td'); if (!td) return; stopEdit(true); at = { r: Number(td.dataset.r), c: Number(td.dataset.c) }; render(); scroll.focus({ preventScroll: true }); });
  table.addEventListener('dblclick', (e) => { if (e.target.closest('td')) startEdit(); });
  scroll.addEventListener('keydown', (e) => {
    if (editing || e.target !== scroll) return;
    const mod = e.ctrlKey || e.metaKey;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) { e.preventDefault(); move(...moves[e.key]); }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); }
    else if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); change(() => { data[at.r][at.c] = ''; }); }
    else if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key === 'y') { e.preventDefault(); redo(); }
    else if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(e.key); }
  });
  function undo() { if (!past.length) return; future.push(snap()); data = JSON.parse(past.pop()); onChange(); render(); }
  function redo() { if (!future.length) return; past.push(snap()); data = JSON.parse(future.pop()); onChange(); render(); }
  render();
  return {
    rows: () => data.map((r) => r.slice()),
    load(rows) { data = rows.map((r) => r.slice()); at = { r: 0, c: 0 }; render(); },
    rowCount: () => data.length,
    colCount: () => width(),
    undo, redo,
    focus: () => scroll.focus({ preventScroll: true }),
  };
}
