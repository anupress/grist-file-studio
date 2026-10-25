// The PDF editor: pages (turn, remove, reorder, copy, take out, split, add pages from other files), fill and sign,
// page numbers and a watermark. Opened over the lightbox like the picture and text editors, and saved the same
// three ways: in place, as a copy, or to the computer. Merging marked files opens it with all their pages.
//
// The state is small and plain, so undo is a snapshot:
//   S.pages  [{id, src, page, rot, removed}]  every page in order, `rot` the clockwise degrees added by the person
//   S.marks  Map(page id -> [mark])           what is drawn on each page (display frame, see media/pdfops.js)
//   S.stamp  {numbers, watermark}             page numbers and a watermark for every saved page

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { trapFocus, openMenu, confirmBox, textBox } from '../ui/dialog.js';
import { chooseFiles } from '../ui/filechooser.js';
import { loadPdfLib, Sources } from '../media/pdfsession.js';
import { buildPdf, displaySize, norm } from '../media/pdfops.js';
import { baseOf } from '../model/kinds.js';
import { createPagesView } from './pdfpages.js';
import { createMarksView } from './pdfmarks.js';
import { t, tn, dateLocale } from '../i18n/index.js';

const TAB_LABELS = { pages: 'Pages', mark: 'Fill and sign', number: 'Numbers' };

const freshStamp = () => ({
  numbers: { on: false, position: 'bc', format: 'n', start: 1, skipFirst: false, size: 10, color: '#374151', word: t('Page'), margin: 28 },
  watermark: { on: false, text: '', size: 72, opacity: 0.25, diagonal: true, color: '#6b7280' },
});

/**
 * @param o {file, source, canSave, canCopy, culture,
 *          onSave(blob, {mode: 'replace'|'copy'|'download', name, pause(on), removeOriginals}) -> Promise<bool>,
 *          onSaveMany(files: [{blob, name}], {pause(on)}) -> Promise<bool>,
 *          pickFiles() -> Promise<[{name, blob}] | null>,
 *          merge: {files: [{name, blob, file}], name} | undefined   (merging marked files: every page of them, in order)}
 */
export async function openPdfEditor(host, o) {
  const f = o.file;
  const merging = !!o.merge;
  const root = el('div', { class: 'gs-lightbox gs-ed gs-pe', role: 'dialog', 'aria-modal': 'true', 'aria-label': merging ? t('Merge into one PDF') : t('Edit {name}', { name: f.name }), tabindex: '-1' });
  const wait = el('div', { class: 'gs-ed__wait', role: 'status' }, [t('Opening the file…')]);
  root.append(wait);
  host.append(root);
  const closeNow = () => { try { sources?.destroy(); } catch { /* already gone */ } root.remove(); };
  let sources = null, lib = null, charset = null;
  const askPassword = (wrong) => textBox(root, {
    title: t('This PDF is protected'),
    body: wrong ? t('That password did not work. Try again.') : t('Type the password to open it. The file you save will not be protected by a password.'),
    label: t('Password'), ok: t('Open'), secret: true,
  });
  const files = merging ? o.merge.files : [{ name: f.name, file: f }];
  try {
    lib = await loadPdfLib();
    const scratch = await lib.PDFDocument.create();
    charset = new Set((await scratch.embedFont(lib.StandardFonts.Helvetica)).getCharacterSet());
    sources = new Sources(lib);
    for (let i = 0; i < files.length; i++) {
      wait.textContent = files.length > 1 ? t('Opening {name}…', { name: files[i].name }) : t('Opening the file…');
      await sources.add(files[i].name, files[i].blob || (await o.source.blob(files[i].file)), askPassword);
    }
  } catch (e) {
    if (e?.cancelled) { closeNow(); return; }
    wait.textContent = t('The PDF could not be opened: {why}', { why: String(e?.message || e) });
    setTimeout(closeNow, 3500);
    return;
  }
  wait.remove();

  // ---- the state, and its history ----
  let counter = 0;
  const newId = (p) => `${p}${++counter}`;
  let S = {
    pages: sources.all().flatMap((s) => Array.from({ length: s.count }, (_, i) => ({ id: newId('p'), src: s.id, page: i, rot: 0, removed: false }))),
    marks: new Map(),
    stamp: freshStamp(),
  };
  const snap = () => ({ pages: S.pages.map((p) => ({ ...p })), marks: new Map([...S.marks].map(([k, v]) => [k, v.slice()])), stamp: JSON.parse(JSON.stringify(S.stamp)) });
  const past = [], future = [];
  let dirty = false, lastKey = null, lastAt = 0, tab = 'pages', busyNote = null;
  const mergeOpts = { name: merging ? o.merge.name : '', removeOriginals: false };

  const kept = () => S.pages.filter((p) => !p.removed);
  const pageSize = (entry) => {
    const s = sources.get(entry.src).sizes[entry.page];
    return norm(entry.rot) % 180 ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
  };
  const stampActive = () => (S.stamp.numbers.on || (S.stamp.watermark.on && S.stamp.watermark.text.trim()) ? S.stamp : null);

  // ---- the frame ----
  const name = el('span', { class: 'gs-lb__name', text: merging ? tn(files.length, '{n} file', '{n} files') : f.name });
  const undoBtn = barBtn('undo', t('Undo (Ctrl+Z)'), () => undo());
  const redoBtn = barBtn('redo', t('Redo (Ctrl+Y)'), () => redo());
  const zoomOut = barBtn('zoomOut', t('Smaller'), () => zoomBy(-0.15));
  const zoomIn = barBtn('zoomIn', t('Larger'), () => zoomBy(0.15));
  const zoomNow = el('button', { type: 'button', class: 'gs-lb__zoom', title: t('Fit the page to the width'), onclick: () => zoomBy(0), text: '100 %' });
  const zoomTools = el('div', { class: 'gs-lb__zoomtools', hidden: true }, [zoomOut, zoomNow, zoomIn, el('span', { class: 'gs-lb__sep' })]);
  const saveBtn = el('button', { type: 'button', class: 'gs-btn gs-btn--primary gs-ed__save', 'aria-haspopup': 'menu', onclick: () => saveMenu() }, [t('Save'), icon('chevron')]);
  const bar = el('div', { class: 'gs-lb__bar' }, [
    barBtn('close', t('Close without saving (Esc)'), () => close()),
    el('span', { class: 'gs-ed__title' }, [merging ? t('Merging') : t('Editing'), ' ', name]),
    el('div', { class: 'gs-lb__tools' }, [zoomTools, undoBtn, redoBtn, el('span', { class: 'gs-lb__sep' }), saveBtn]),
  ]);
  const tabs = el('div', { class: 'gs-ed__tabs', role: 'tablist' });
  const panelBody = el('div', { class: 'gs-ed__panel-body' });
  const panel = el('aside', { class: 'gs-ed__panel', 'aria-label': t('Tools') }, [tabs, panelBody]);
  const flashBox = el('div', { class: 'gs-pe__flash', role: 'status', hidden: true });
  const body = el('div', { class: 'gs-ed__body' });
  root.append(bar, body, flashBox);
  const release = trapFocus(root, () => close());
  function barBtn(ic, label, onclick) { return el('button', { type: 'button', class: 'gs-lb__btn', title: label, 'aria-label': label, onclick }, [icon(ic)]); }

  let flashTimer = 0;
  function flash(msg, ms = 6000) {
    flashBox.textContent = msg; flashBox.hidden = false;
    clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashBox.hidden = true; }, ms);
  }
  function busy(on, msg = t('Saving…')) {
    if (on) { busyNote = el('div', { class: 'gs-ed__wait', role: 'status' }, [msg]); root.append(busyNote); }
    else if (busyNote) { busyNote.remove(); busyNote = null; }
  }
  function syncBar() {
    undoBtn.disabled = !past.length; redoBtn.disabled = !future.length;
    saveBtn.disabled = !kept().length || (merging && !mergeOpts.name.trim());
  }

  // ---- the editor the views talk to ----
  const ctx = {
    root, sources, charset, kept, pageSize, newId, merging,
    get S() { return S; },
    commit(fn, { coalesce = null, keepPanel = false, quiet = false } = {}) {
      const now = Date.now();
      if (!(coalesce && coalesce === lastKey && now - lastAt < 1200)) { past.push(snap()); if (past.length > 100) past.shift(); future.length = 0; }
      lastKey = coalesce; lastAt = now;
      fn(S);
      dirty = true;
      syncBar();
      if (!quiet) refresh({ panel: !keepPanel });
    },
    repanel: () => renderPanel(),
    toast: (m) => flash(m),
    today: () => new Intl.DateTimeFormat(dateLocale(o.culture), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
    onUnsupported: (chars) => { if (chars.length) flash(t('These letters cannot be drawn with a PDF’s standard fonts and will show as “?”: {chars}', { chars: chars.join(' ') }), 9000); },
    addFiles,
    saveParts,
  };
  const views = { pages: createPagesView(ctx), mark: createMarksView(ctx, 'mark'), number: createMarksView(ctx, 'number') };
  let active = views.pages;

  function restore(s) { S = { pages: s.pages, marks: s.marks, stamp: s.stamp }; lastKey = null; }
  function undo() { if (!past.length) return; future.push(snap()); restore(past.pop()); dirty = true; syncBar(); refresh({ panel: true }); }
  function redo() { if (!future.length) return; past.push(snap()); restore(future.pop()); dirty = true; syncBar(); refresh({ panel: true }); }
  function zoomBy(d) { const pct = active.zoom?.(d); if (pct) zoomNow.textContent = `${pct} %`; }

  function refresh({ panel = true } = {}) {
    active.refresh();
    if (panel) renderPanel();
    syncBar();
  }
  function renderTabs() {
    clear(tabs).append(...Object.keys(TAB_LABELS).map((id) => el('button', {
      type: 'button', role: 'tab', class: 'gs-ed__tab' + (tab === id ? ' is-on' : ''), 'aria-selected': tab === id ? 'true' : 'false', text: t(TAB_LABELS[id]), onclick: () => showTab(id),
    })));
  }
  function showTab(id) {
    if (id === tab && body.firstChild === active.stage) return;
    active.deactivate?.();
    const previous = body.firstChild;
    tab = id;
    active = views[id];
    if (previous) body.replaceChild(active.stage, previous); else body.prepend(active.stage);
    if (!body.contains(panel)) body.append(panel);
    zoomTools.hidden = id === 'pages';
    zoomNow.textContent = `${active.zoomLevel?.() ?? 100} %`;
    renderTabs();
    renderPanel();
    active.activate?.();
  }
  function renderPanel() {
    // The panel is drawn again after every change; keep the keyboard where it was (same control, or the editor),
    // or Ctrl+Z and the arrow keys would stop working after the first button press.
    const controls = () => [...panelBody.querySelectorAll('button, input, select, textarea')];
    const at = controls().indexOf(document.activeElement);
    const inside = root.contains(document.activeElement);
    clear(panelBody);
    if (sources.all().some((s) => s.signed)) {
      panelBody.append(el('p', { class: 'gs-pe__note', role: 'note', text: t('This PDF carries a digital signature. A changed copy no longer has a valid one, so “Save as copy” is the safer choice.') }));
    }
    if (merging && tab === 'pages') panelBody.append(mergeGroup());
    active.renderPanel(panelBody);
    if (at >= 0 && controls()[at]) controls()[at].focus({ preventScroll: true });
    else if (inside && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
  }
  function mergeGroup() {
    const nameInput = el('input', { class: 'gs-input', type: 'text', value: mergeOpts.name, 'aria-label': t('Name of the new file'),
      oninput: (e) => { mergeOpts.name = e.target.value; syncBar(); } });
    return el('div', { class: 'gs-ed__group' }, [
      el('div', { class: 'gs-ed__label', text: t('The new file') }),
      nameInput,
      el('label', { class: 'gs-check' }, [el('input', { type: 'checkbox', checked: mergeOpts.removeOriginals, onchange: (e) => { mergeOpts.removeOriginals = e.target.checked; } }), t('Take the originals out of their records')]),
      el('p', { class: 'gs-hint', text: t('The new PDF goes in next to the first file. Pages you reorder or remove here change the result, not the originals.') }),
    ]);
  }

  // ---- adding pages from other files ----
  async function addFiles() {
    const picked = await o.pickFiles?.(root);
    if (!picked?.length) return [];
    const added = [];
    busy(true, t('Adding pages…'));
    try {
      for (const p of picked) {
        try { added.push(await sources.add(p.name, p.blob, askPassword)); }
        catch (e) { if (!e?.cancelled) flash(t('“{name}” could not be added: {why}', { name: p.name, why: String(e?.message || e) })); }
      }
    } finally { busy(false); }
    return added;
  }

  // ---- building and saving ----
  async function build(entries) {
    const plan = entries.map((e) => ({ id: e.id, src: e.src, page: e.page, rotate: e.rot }));
    const r = await buildPdf(lib, { load: sources.load, pages: plan, marks: S.marks, stamp: stampActive() });
    if (r.dropped.length) ctx.onUnsupported(r.dropped);
    return new Blob([r.bytes], { type: 'application/pdf' });
  }
  const base = () => baseOf(merging ? mergeOpts.name || o.merge.name : f.name);
  const mergeName = () => { const n = mergeOpts.name.trim(); return /\.pdf$/i.test(n) ? n : n + '.pdf'; };

  async function save(mode) {
    const list = kept();
    if (!list.length) return;
    busy(true);
    try {
      const blob = await build(list);
      const nm = merging ? mergeName() : mode === 'copy' ? `${base()} (${t('edited')}).pdf` : f.name.replace(/\.pdf$/i, '') + '.pdf';
      const done = await o.onSave(blob, { mode, name: nm, pause: (on) => { if (busyNote) busyNote.hidden = on; }, removeOriginals: merging && mergeOpts.removeOriginals ? o.merge.files : null });
      busy(false);
      if (done) { dirty = false; close(true); }
    } catch (e) {
      busy(false);
      flash(t('Not saved: {why}', { why: String(e?.message || e) }));
    }
  }
  function saveMenu() {
    const items = merging ? [
      [t('Save as a new file'), () => save('copy'), { disabled: !o.canCopy, hint: t('Next to the first file') }],
      [t('Download'), () => save('download'), { hint: t('Only to your computer; the document stays as it is') }],
    ] : [
      [t('Save'), () => save('replace'), { disabled: !o.canSave, hint: o.canSave ? t('The edited file takes the original’s place') : t('You cannot change this file here; save a copy or download it') }],
      [t('Save as copy'), () => save('copy'), { disabled: !o.canCopy, hint: t('Next to the original, which stays as it is') }],
      [t('Download'), () => save('download'), { hint: t('Only to your computer; the document stays as it is') }],
    ];
    openMenu(root, saveBtn, items);
  }

  const numbersText = (entries) => {
    const all = kept();
    const nums = entries.map((e) => all.indexOf(e) + 1).sort((a, b) => a - b);
    const runs = [];
    for (const n of nums) { const last = runs[runs.length - 1]; if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]); }
    return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
  };
  /** Pages taken out as new files, next to the original. parts: [{entries}] */
  async function saveParts(parts) {
    if (!o.canCopy || !o.onSaveMany) { flash(t('You cannot add files to this record from here. Use Download in the Save menu instead.')); return; }
    busy(true);
    try {
      const out = [];
      for (const part of parts) {
        const nm = `${base()} (${part.entries.length === 1 ? t('page') : t('pages')} ${numbersText(part.entries)}).pdf`;
        out.push({ blob: await build(part.entries), name: nm });
      }
      await o.onSaveMany(out, { pause: (on) => { if (busyNote) busyNote.hidden = on; } });   // the app says it was saved, with Undo
      busy(false);
    } catch (e) {
      busy(false);
      flash(t('Not saved: {why}', { why: String(e?.message || e) }));
    }
  }

  // ---- closing and keys ----
  async function close(force = false) {
    if (!force && dirty) {
      const ok = await confirmBox(root, { title: t('Close without saving?'), body: t('Your changes to this file will be lost.'), ok: t('Close without saving'), danger: true });
      if (!ok) return;
    }
    clearTimeout(flashTimer);
    release();
    for (const v of Object.values(views)) { v.deactivate?.(); v.destroy?.(); }
    closeNow();
  }
  root.addEventListener('keydown', (e) => {
    const inField = e.target.closest('input, textarea, select, .gs-dialog, .gs-menu');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.target.closest('textarea, .gs-dialog')) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); if (!saveBtn.disabled) save(merging ? 'copy' : o.canSave ? 'replace' : o.canCopy ? 'copy' : 'download'); return; }
    }
    if (inField) return;
    if (active.key?.(e)) e.preventDefault();
  });

  body.append(views.pages.stage, panel);
  active.activate?.();
  renderTabs();
  renderPanel();
  syncBar();
  root.focus({ preventScroll: true });
}
