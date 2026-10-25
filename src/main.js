// File Studio entry point: connect, work out which columns hold files, build the gallery, draw it
// as cards, a wall of files or a viewer, and write changes back.
//
// Two sources feed the same code: a real Grist (rows pushed by onRecords, file metadata and contents
// read with full access) or the demo (src/demo/sample.js), used whenever no Grist answers. In the demo
// every change stays in memory and has its own undo; in Grist a change is one action, undone by Grist.

import { el, clear } from './core/util.js';
import { VERSION } from './version.js';
import { start, accessLevel, selectedTableId, gristCulture, setOptions, moveCursor, apply, undo as gristUndo, redo as gristRedo, linkingInfo, fetchRows } from './grist/connect.js';
import { fileUrl, fileBlob, fileHead, uploadFiles, dropTokens, docUrl, storageInfo, freeUnusedFiles } from './grist/files.js';
import { loadColumns, loadFileMeta, loadAttachmentRows, loadLabels, loadOwnSection, forgetMeta, loadLocations } from './data/live.js';
import { resolveRoles, toStored, detectRoles } from './model/roles.js';
import { buildGallery, metaFromRows, visibleFiles, visibleRecords, groupCounts, sortFiles, matcher, listSortFor } from './model/files.js';
import { hitFor } from './model/textsearch.js';
import { newFolder as newFolderActions, renameFolder as renameFolderActions, canName, newestId, folderStats, clipFiles } from './model/folders.js';
import { NOTES_TABLE, createTable, cleanTag, rowsAreNotes, parseNotes, allTags, setNote, addTagTo, carryNotes, notesText } from './model/notes.js';
import { attachmentIds, cellText } from './model/values.js';
import { addFiles as addFilesActions, removeFile, removeFiles, moveFile, newRecords, renameFiles, sharedValue, replaceFile, replaceEverywhere, removeEverywhere, removeManyEverywhere, replaceMany, insertAfter, insertManyAfter, mergeResult, copyFilesTo, moveFilesTo } from './model/edits.js';
import { buildIndex, cellLink } from './model/locations.js';
import { exportPaths, safeName } from './model/names.js';
import { extOf, baseOf, sizeText, typeLabel } from './model/kinds.js';
import { readOptions, writeOptions, readView, writeView } from './model/settings.js';
import { createThumbs } from './media/thumbs.js';
import { openPdf } from './media/pdf.js';
import { makeZip, manifestCsv, ZIP_LIMIT } from './media/zip.js';
import { shrinkPhoto } from './media/shrink.js';
import { TextIndex, canRead } from './media/textindex.js';
import { ExifIndex, hasExif } from './media/exifindex.js';
import { createWall } from './views/wall.js';
import { createViewer } from './views/viewer.js';
import { openLightbox } from './views/lightbox.js';
import { openCompare } from './views/compare.js';
import { createBars, GROUP_LABELS, SORT_LABELS } from './ui/bars.js';
import { openPalette } from './ui/palette.js';
import { openColumns } from './ui/columns.js';
import { openLibrary } from './ui/library.js';
import { reportBox } from './ui/reportbox.js';
import { openNoteBox } from './ui/notebox.js';
import { openProps } from './ui/propsbox.js';
import { REPORT_PICTURE } from './media/reportimages.js';
import { createTray } from './ui/tray.js';
import { openKeys } from './ui/keys.js';
import { renameBox } from './ui/renamebox.js';
import { openRowCard, placesDialog } from './ui/rowcard.js';
import { pickRecord } from './ui/recordpicker.js';
import { chooseFiles } from './ui/filechooser.js';
import { confirmBox, textBox, choiceBox, openMenu } from './ui/dialog.js';
import { t, tn, setLanguage, storedLanguage, dateLocale, uiLang } from './i18n/index.js';
import { DEMO_TABLE, DEMO_COLUMNS, DEMO_FIELDS, demoMeta, demoRows, demoSource, speedData } from './demo/sample.js';

const S = {
  live: false, demo: false, ready: false, problem: null,
  tableId: null, columns: [], roles: { files: [], title: null, fields: [] }, settings: readOptions(null), options: null,
  rows: [], meta: new Map(), labels: {}, gallery: null, ownSection: null,
  view: { layout: null, query: '', tag: '', group: null, sort: null, cardSize: null, fileSize: null, fit: null, grouped: null, captions: null, cover: null, empty: null },
  current: null, selfCursor: null, marked: new Set(), lastMark: null, fresh: new Set(), clip: null,
  lb: null,   // {box, scope: 'wall' | rowId}
  // Searching inside files: on/off is this browser's choice; the text itself is read on request (see "inside files" below).
  inside: { on: false, reading: false, done: 0, total: 0 }, readable: new Map(),
};
const demoHistory = { undo: [], redo: [] };
// The language first: everything below builds its labels once, in the language set now.
setLanguage(storedLanguage(), { remember: false });

// ---- the page --------------------------------------------------------------------------------------
const app = document.getElementById('app');
const chrome = el('div', { class: 'gs-toolbar' });
const filters = el('div', { class: 'gs-filters' });
const banner = el('div', { class: 'gs-banner', hidden: true });
const stage = el('div', { class: 'gs-stage' });
const toastBox = el('div', { class: 'gs-toast', role: 'status', 'aria-live': 'polite', hidden: true });
const srBox = el('div', { class: 'gs-sr', role: 'status', 'aria-live': 'polite' });
const shell = el('div', { class: 'gs-app', dataset: { version: VERSION } }, [chrome, filters, banner, stage, toastBox, srBox]);
const picker = el('input', { type: 'file', multiple: true, hidden: true });
shell.append(picker);
clear(app).appendChild(shell);
const tray = createTray(shell);

function announce(text) { srBox.textContent = ''; setTimeout(() => { srBox.textContent = text; }, 30); }
let toastTimer = 0;
function toast(msg, action = null, ms = null) {
  clear(toastBox).append(el('span', { text: msg }));
  if (action) toastBox.append(el('button', { type: 'button', class: 'gs-toast__btn', text: action.label, onclick: () => { toastBox.hidden = true; action.run(); } }));
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  if (ms !== 0) toastTimer = setTimeout(() => { toastBox.hidden = true; }, ms || (action ? 7000 : 4500));
}
const errText = (e) => String(e?.message || e || '').replace(/^Error:\s*/, '').slice(0, 200);

// ---- the file source and thumbnails -------------------------------------------------------------------
let source = null;
let thumbs = null;
let reflowTimer = 0;
function makeThumbs() {
  thumbs = createThumbs(source, { onAspect: () => { clearTimeout(reflowTimer); reflowTimer = setTimeout(() => wall?.reflow(), 250); } });
}
const liveSource = {
  url: (file, o = {}) => fileUrl(file.attId, o),
  head: (file, n, o = {}) => fileHead(file.attId, n, o),
  blob: (file, o = {}) => fileBlob(file.attId, o),
  openPdf,
  upload: (files, o) => uploadFiles(files, o),
};

// ---- who may write ------------------------------------------------------------------------------------
function readOnlyWhy() {
  if (S.demo) return null;
  if (!S.live) return t('Not connected to Grist.');
  try { if (new URLSearchParams(location.search).get('readonly') === 'true') return t('You can view this document but not edit it.'); } catch { /* no URL */ }
  if (accessLevel() !== 'full') return t('This widget needs full document access. Set it in the widget panel on the right.');
  return null;
}
const canEdit = () => readOnlyWhy() == null;
const fileColumn = () => S.roles.files.map((id) => S.columns.find((c) => c.id === id)).find((c) => c && !c.isFormula) || null;
const canEditFile = (f) => canEdit() && !f.readOnly;
const canRename = (f) => canEdit() && !!f;

// ---- formats ------------------------------------------------------------------------------------------
const fmtCache = new Map();
function fmt() {
  const loc = dateLocale(gristCulture());
  if (!fmtCache.has(loc)) {
    const d = new Intl.DateTimeFormat(loc, { timeZone: 'UTC', dateStyle: 'medium' });
    const nf = new Intl.NumberFormat(loc);
    fmtCache.set(loc, {
      date: (s) => d.format(new Date(s * 1000)),
      dateTime: (s, zone) => { try { return new Intl.DateTimeFormat(loc, { timeZone: zone || undefined, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s * 1000)); } catch { return d.format(new Date(s * 1000)); } },
      number: (n) => nf.format(n),
    });
  }
  return fmtCache.get(loc);
}

// ---- the model -----------------------------------------------------------------------------------------
function rebuild() {
  S.gallery = buildGallery({ rows: S.rows, columns: S.columns, roles: S.roles, meta: S.meta, labels: S.labels, fmt: fmt() });
  // Column labels for the lightbox's details.
  const labels = new Map(S.columns.map((c) => [c.id, c.label]));
  for (const f of S.gallery.files) f.colLabel = labels.get(f.col) || f.col;
  // Marks on files that are gone are dropped.
  if (S.marked.size) { const keys = new Set(S.gallery.files.map((f) => f.key)); for (const k of [...S.marked]) if (!keys.has(k)) S.marked.delete(k); }
  // The files whose text can be read, one per content (the same file in two records is read once).
  annotateNotes();
  S.readable = new Map();
  for (const f of S.gallery.files) if (canRead(f)) { const id = identOf(f); if (!S.readable.has(id)) S.readable.set(id, f); }
  if (S.inside.on) loadKnownText();
}
const recordOf = (rowId) => S.gallery?.records.find((r) => r.rowId === rowId) || null;
const rowOf = (rowId) => S.rows.find((r) => r.id === rowId) || null;
const cellOf = (rowId, col) => rowOf(rowId)?.[col] ?? null;
const textOf = (rowId, colId) => { const c = S.columns.find((x) => x.id === colId); const r = rowOf(rowId); return c && r ? cellText(r[colId], c, S.labels[colId], fmt()) : null; };

// ---- view state (this browser) ---------------------------------------------------------------------------
const V = () => {
  const v = S.view, s = S.settings;
  return {
    layout: v.layout || s.layout, cardSize: v.cardSize || s.cards.size, fileSize: v.fileSize || s.files.size,
    fit: v.fit || s.files.fit, grouped: v.grouped ?? s.files.grouped, captions: v.captions ?? s.files.captions, cover: v.cover || s.cards.cover,
    query: v.query, group: v.group, sort: v.sort, tag: v.tag, empty: !!v.empty,
  };
}
function setView(patch, { remember = true } = {}) {
  Object.assign(S.view, patch);
  if (remember) {
    const keep = {};
    for (const k of ['layout', 'cardSize', 'fileSize', 'fit', 'grouped', 'captions', 'cover', 'sort', 'group', 'empty']) if (k in patch) keep[k] = patch[k];
    if (Object.keys(keep).length) writeView(S.tableId, keep);
  }
}

// ---- drawing ------------------------------------------------------------------------------------------------
let wall = null, viewer = null;
function dropViews() { wall?.destroy(); wall = null; viewer?.destroy(); viewer = null; }

const bars = createBars(chrome, filters, {
  onLayout: (id) => { setView({ layout: id }); clearMarks(false); render(); announce(t(id === 'cards' ? 'Cards' : id === 'files' ? 'Files' : 'Viewer')); },
  onAdd: () => pickFiles(S.current),
  onDownload: (anchor) => downloadMenu(anchor),
  onKeys: () => openKeys(shell),
  onColumns: () => openColumnsPanel(),
  onStorage: () => openStorage(),
  onQuery: (q) => { setView({ query: q }, { remember: false }); render(); },
  onTag: (tag) => { setView({ tag }, { remember: false }); render(); },
  onMarkedTag: () => tagMarked(),
  onInside: () => toggleInside(),
  onInsideRead: () => startReading(),
  onInsideStop: () => insideRun?.abort(),
  onGroup: (g) => { setView({ group: g }); render(); },
  onSort: (s) => { setView({ sort: s }); if (byDate(s)) readDatesFor(); render(); },
  onDatesRead: () => startDates(),
  onDatesStop: () => datesRun?.abort(),
  onSize: (n) => { setView(V().layout === 'cards' ? { cardSize: n } : { fileSize: n }); render(); },
  onFit: (f) => { setView({ fit: f }); render(); },
  onGrouped: (on) => { setView({ grouped: on }); render(); },
  onCaptions: (on) => { setView({ captions: on }); render(); },
  onEmpty: (on) => { setView({ empty: on }); render(); },
  onCover: (c) => { setView({ cover: c }); render(); },
  onMarkAll: () => { for (const f of shownFiles()) S.marked.add(f.key); renderState(); },
  onMarkedZip: () => zipFiles(markedFiles(), t('Marked files')),
  onMarkedRemove: () => removeMany(markedFiles()),
  onMarkedRename: () => renameMany(markedFiles()),
  onMarkedMerge: () => mergeFiles(markedFiles()),
  onMarkedReport: () => photoReport(markedFiles(), null),
  onMarkedCompare: () => { const [a, b] = markedFiles(); if (a && b) compareFiles(a, b); },
  onMarkedClear: () => clearMarks(),
});

function updateBars(level = 'full') {
  const v = V();
  const files = S.gallery?.files || [];
  bars.update({
    level, mode: S.demo ? 'demo' : canEdit() ? 'live' : 'ro', readOnlyWhy: readOnlyWhy(), layout: v.layout, editable: canEdit() && !!fileColumn(),
    records: S.gallery?.records.length || 0, files: files.length, query: v.query, group: v.group, groupCounts: groupCounts(files), sort: v.sort,
    size: v.layout === 'cards' ? v.cardSize : v.fileSize, fit: v.fit, grouped: v.grouped, captions: v.captions, cover: v.cover, empty: v.empty, markedCount: S.marked.size, markedPictures: markedFiles().some((f) => REPORT_PICTURE.test(f.ext)), markedPair: (() => { const m = markedFiles(); return m.length === 2 && m.every((f) => f.kind === 'image'); })(),
    inside: insideInfo(), dates: datesInfo(), tags: allTags(NOTES.map), tag: v.tag,
  });
}

function emptyState(title, body, actions = []) {
  dropViews();
  clear(stage).appendChild(el('div', { class: 'gs-empty' }, [
    el('h2', { text: title }), el('p', { text: body }),
    actions.length ? el('div', { class: 'gs-empty__actions' }, actions.map(([label, run], i) => el('button', { type: 'button', class: 'gs-btn' + (i ? '' : ' gs-btn--primary'), text: label, onclick: run }))) : null,
  ]));
}

/** What the Files wall shows, in order. */
function filesData() {
  const v = V();
  const inside = insideFn();
  const vis = visibleFiles(S.gallery, { query: v.query, group: v.group, sort: v.sort, inside, taken: takenOf, tag: v.tag, empty: v.empty ? true : S.fresh });
  setHits(vis.files, v.query, inside);
  const groups = v.grouped ? vis.groups : [{ rec: null, files: v.sort === 'cell' ? vis.files : sortFiles(vis.files, v.sort, { taken: takenOf }) }];
  return { groups, size: v.fileSize, fit: v.fit, grouped: v.grouped, captions: v.captions, sort: v.sort };
}
const shownFiles = () => (V().layout === 'files' && wall ? wall.files() : []);
const markedFiles = () => (S.gallery?.files || []).filter((f) => S.marked.has(f.key));

function render() {
  if (!S.ready) return;
  if (S.problem) { updateBars(S.problem.level || 'bare'); emptyState(S.problem.title, S.problem.body, S.problem.actions || []); return; }
  updateBars();
  const v = V();
  if (!S.roles.files.length) {
    emptyState(t('No Attachments column'), canEdit()
      ? t('File Studio shows the files in a table’s Attachments columns. This table has none yet.')
      : t('File Studio shows the files in a table’s Attachments columns. This table has none.'),
    canEdit() ? [[t('Add an Attachments column'), addFilesColumn], [t('Columns'), openColumnsPanel]] : [[t('Columns'), openColumnsPanel]]);
    return;
  }
  if (v.layout === 'viewer') {
    if (wall) { wall.destroy(); wall = null; }
    if (!viewer) {
      clear(stage);
      viewer = createViewer(stage, { source, thumbs, culture: gristCulture() }, {
        onStep: (d) => stepRecord(d),
        onOpen: (f, list) => openFile(f, list, f.rowId),
        onAdd: (rowId) => pickFiles(rowId),
        onDrop: (rowId, files) => addFiles(files, rowId),
        onReorder: (f, to) => reorder(f, to),
        onMenu: (f, anchor) => fileMenu(f, anchor),
        onDownload: (f) => downloadFile(f),
        onZip: (rowId) => zipRecord(rowId),
        onReport: (rowId) => photoReport(recordOf(rowId)?.files || [], recordOf(rowId)),
      });
    }
    const recs = S.gallery.records;
    if (S.current == null || !recordOf(S.current)) S.current = recs[0]?.rowId ?? null;
    const index = recs.findIndex((r) => r.rowId === S.current);
    viewer.set(recordOf(S.current), { editable: canEdit() && !!fileColumn(), index, count: recs.length });
  } else {
    if (viewer) { viewer.destroy(); viewer = null; }
    if (!wall) {
      clear(stage);
      wall = createWall(stage, thumbs, {
        onOpen: (f) => openFile(f, null, V().layout === 'cards' ? f.rowId : 'wall'),
        onSelect: (rowId) => select(rowId),
        onMark: (f, mode) => mark(f, mode),
        onMenu: (f, anchor) => fileMenu(f, anchor),
        culture: gristCulture(),
        onSort: (column) => { setView({ sort: listSortFor(column, V().sort) }); if (byDate(V().sort)) readDatesFor(); render(); },
        onRecordMenu: (rowId, anchor) => recordMenu(rowId, anchor),
        onSpaceMenu: (anchor) => spaceMenu(anchor),
        onDrop: (rowId, files) => addFiles(files, rowId),
        onAdd: (rowId) => pickFiles(rowId),
        onView: (rowId) => { select(rowId); setView({ layout: 'viewer' }); render(); },
        onRemove: (f) => removeOne(f),
        onSendFiles: (keys, rowId, mode) => { const files = (S.gallery?.files || []).filter((x) => keys.includes(x.key)); if (files.length) sendTo(files, mode, rowId); },
        onFocusFile: (f) => { if (f.rowId !== S.current) select(f.rowId, { scroll: false }); },
      });
    }
    if (v.layout === 'cards') {
      setHits([], '', null);
      const records = visibleRecords(S.gallery, { query: v.query, inside: insideFn() });
      if (!records.length) emptyInWall(v.query ? t('No record matches “{q}”.', { q: v.query }) : t('No records to show. Grist’s filters or a linked selection may hide them.'));
      else wall.setCards({ records, size: v.cardSize, fields: S.roles.fields.length, cover: v.cover });
    } else {
      const d = filesData();
      if (!d.groups.length || (!d.grouped && !d.groups[0].files.length)) {
        emptyInWall(v.query || v.tag || v.group !== 'all' ? t('No file matches these filters.') : canEdit() ? t('No files yet. Drop files here, paste a screenshot, or use Add files.') : t('No files in these records.'));
      } else wall.setFiles(d);
    }
    renderState();
  }
  if (S.lb) S.lb.box.update(lightboxList(S.lb.scope));
}
function emptyInWall(text) {
  wall?.destroy(); wall = null;
  clear(stage).append(el('div', { class: 'gs-empty' }, [el('p', { text })]));
  // The empty wall still takes dropped files: they become new records.
  const sheet = stage.firstChild;
  stage.ondragover = (e) => { if (canEdit() && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); };
  stage.ondrop = (e) => { if (!canEdit() || !e.dataTransfer?.files?.length) return; e.preventDefault(); addFiles([...e.dataTransfer.files], null); };
  return sheet;
}
function renderState() {
  updateBars();
  wall?.setState({ current: S.current, marked: S.marked, editable: canEdit() && !!fileColumn(), cut: S.clip?.mode === 'cut' ? new Set(S.clip.keys) : new Set() });
}

// ---- selecting --------------------------------------------------------------------------------------------
function select(rowId, { tellGrist = true, scroll = false } = {}) {
  if (rowId == null) return;
  S.current = rowId;
  if (tellGrist && !S.demo) { S.selfCursor = rowId; moveCursor(rowId).catch(() => {}); }
  if (scroll) wall?.scrollToRecord(rowId);
  if (V().layout === 'viewer') render(); else renderState();
}
function stepRecord(d) {
  const recs = S.gallery.records;
  const i = recs.findIndex((r) => r.rowId === S.current);
  const next = recs[Math.max(0, Math.min(recs.length - 1, (i < 0 ? 0 : i) + d))];
  if (next) select(next.rowId);
}
function mark(f, mode) {
  if (mode === 'range' && S.lastMark) {
    const list = shownFiles();
    const a = list.findIndex((x) => x.key === S.lastMark), b = list.findIndex((x) => x.key === f.key);
    if (a >= 0 && b >= 0) { for (let k = Math.min(a, b); k <= Math.max(a, b); k++) S.marked.add(list[k].key); }
    else S.marked.add(f.key);
  } else if (S.marked.has(f.key)) S.marked.delete(f.key);
  else S.marked.add(f.key);
  S.lastMark = f.key;
  renderState();
  announce(tn(S.marked.size, '{n} file marked', '{n} files marked'));
}
function clearMarks(draw = true) { S.marked.clear(); S.lastMark = null; if (draw) renderState(); }

// ---- the lightbox --------------------------------------------------------------------------------------------
function lightboxList(scope) {
  if (scope === 'wall') return shownFiles();
  return recordOf(scope)?.files || [];
}
function openFile(f, list, scope) {
  S.lb?.box.close();
  const files = list || lightboxList(scope);
  const index = Math.max(0, files.findIndex((x) => x.key === f.key));
  const box = openLightbox(shell, {
    files, index, source, thumbs, culture: gristCulture(),
    canEdit: (x) => canEditFile(x), canRename: (x) => canRename(x), canEditContent: (x) => canEditContent(x),
    menuItems: (x, ctx) => menuItems(x, ctx), onEdit: (x) => editFile(x), whereIs: (x) => placesOf(x), onShowRow: (p) => showRow(p),
    onRecord: (x) => { select(x.rowId, { scroll: true }); box.close(); },
    onDownload: (x) => downloadFile(x),
    hitOf: (x) => x.hit || null,
    onCompare: (a, b) => compareFiles(a, b),
    exifOf: (x) => exifOf(x),
    notesOf: (x) => notesOf(x), onNotes: (x) => editNotes(x),
    onOpenTab: (x) => openInTab(x),
    onRename: (x) => renameOne(x),
    onCover: (x) => reorder(x, 0),
    onRemove: (x) => removeOne(x),
    onShow: (x) => { if (x.rowId !== S.current) select(x.rowId, { scroll: false }); },
    onClose: (x) => { S.lb = null; if (x && V().layout === 'files') wall?.focusFile(x.key); else wall?.focus(); },
  });
  S.lb = { box, scope };
}

/** Two pictures with a divider between them. */
function compareFiles(a, b) { openCompare(shell, { a, b, source }); }

// ---- the file menu ----------------------------------------------------------------------------------------------
// One menu for a file wherever it is shown: on a tile, in the Viewer, in the lightbox.
function menuItems(f, { inLightbox = false } = {}) {
  const can = canEditFile(f);
  const items = [];
  if (!inLightbox) items.push([t('Open'), () => openFile(f, null, V().layout === 'files' ? 'wall' : f.rowId)]);
  if (canEditContent(f)) items.push([t('Edit…'), () => editFile(f), { hint: can ? null : t('Changes can be downloaded, not saved here') }]);
  items.push(
    [t('Download'), () => downloadFile(f)],
    [t('Open in a new tab'), () => openInTab(f)],
    [t('Where it is…'), () => showPlaces(f)],
    [t('Tags and note…'), () => editNotes(f), { hint: t('Words to find the file by, and a note about it') }],
    null,
    [t('Rename…'), () => renameOne(f), { disabled: !canRename(f) }],
    [t('Duplicate'), () => duplicate(f), { disabled: !can, hint: t('A separate copy next to this file') }],
    !inLightbox && [t('Cut'), () => setClip(S.marked.has(f.key) ? markedFiles() : [f], 'cut'), { disabled: !can, hint: t('Then choose a folder and paste with Ctrl+V') }],
    !inLightbox && [t('Copy'), () => setClip(S.marked.has(f.key) ? markedFiles() : [f], 'copy'), { disabled: !canEdit() || !fileColumn(), hint: t('Then choose a folder and paste with Ctrl+V') }],
    ...(mergeable(f) ? [[t('Merge with…'), () => mergeWith(f), { disabled: !canEdit(), hint: t('Put pages of several PDFs and pictures into one new PDF') }]] : []),
    [t('Copy to…'), () => sendTo([f], 'copy'), { disabled: !canEdit() || !fileColumn(), hint: t('The same file, also in another record') }],
    [t('Move to…'), () => sendTo([f], 'move'), { disabled: !can }],
    [t('Replace with…'), () => replaceWith(f), { disabled: !can, hint: t('Put a file from your computer in its place') }],
    [t('Make cover'), () => reorder(f, 0), { disabled: !can || f.index === 0, hint: t('Move this file to the front of its record') }],
  );
  if (!inLightbox && V().layout === 'files') items.push([S.marked.has(f.key) ? t('Unmark') : t('Mark'), () => mark(f, 'toggle')]);
  items.push(null,
    [t('Remove from this record'), () => removeOne(f), { danger: true, disabled: !can,
      note: t('Only this cell; the file stays in the document'),
      hint: t('Other cells that hold the file keep it. A file no cell uses is kept by Grist for a while, then deleted.') }],
    [t('Remove from every place…'), () => removeEverywhereAsk(f), { danger: true, disabled: !canEdit(),
      note: t('Every cell that holds it, in any table') }]);
  return items;
}
function fileMenu(f, anchor) {
  // Right click on one of several marked files: the menu of the marked files, as on a computer.
  if (S.marked.size > 1 && S.marked.has(f.key) && V().layout === 'files') { markedMenu(anchor); return; }
  openMenu(shell, anchor, menuItems(f));
}

// ---- what can be edited -------------------------------------------------------------------------------------------
// Pictures the browser can decode and re-encode, text, and PDFs. Video, audio and office files are not edited.
const IMAGE_EDITABLE = /^(jpe?g|jfif|pjpeg|png|webp|bmp|gif|avif)$/;
const editorKind = (f) => (IMAGE_EDITABLE.test(f.ext) ? 'image' : f.ext === 'pdf' ? 'pdf' : f.kind === 'text' || f.ext === 'svg' ? 'text' : null);
const canEditContent = (f) => { const k = editorKind(f); return k === 'image' ? f.size <= 60e6 : k === 'pdf' ? f.size <= 80e6 : k === 'text' ? f.size <= 2e6 : false; };
// What can be merged into one PDF: PDFs and the pictures the browser can read.
const MERGEABLE = /^(pdf|jpe?g|jfif|pjpeg|png|webp|gif|bmp|avif)$/;
const mergeable = (f) => MERGEABLE.test(f.ext) && f.size <= 80e6;

async function editFile(f) {
  const kind = editorKind(f);
  if (!kind) return;
  const opts = {
    file: f, source, culture: gristCulture(),
    canSave: canEditFile(f), canCopy: canEdit() && (!f.readOnly || !!fileColumn()),
    onSave: (blob, o) => saveEdited(f, blob, o),
    onSaveMany: (parts, o) => saveMany(f, parts, o),
    pickFiles: (host) => pickMore(f, host),
  };
  try {
    if (kind === 'image') (await import('./views/imageeditor.js')).openImageEditor(shell, opts);
    else if (kind === 'pdf') (await import('./views/pdfeditor.js')).openPdfEditor(shell, opts);
    else (await import('./views/texteditor.js')).openTextEditor(shell, opts);
  } catch (e) { toast(t('The editor did not open: {why}', { why: errText(e) })); }
}

/** Upload one file, with a line in the tray. Resolves the new id, or null. */
async function uploadOne(blob, name) {
  const [h] = tray.start([{ name, size: blob.size }]);
  try {
    const [id] = await source.upload([{ blob, name }], { onProgress: (a, b) => h.progress(b ? a / b : 0) });
    h.done();
    if (!S.demo) S.meta = await loadFileMeta().catch(() => S.meta);
    return id;
  } catch (e) { h.fail(uploadWhy(e)); return null; }
}

/** Upload several files at once, a line each in the tray. Resolves the new ids in order, or null. */
async function uploadAll(items) {
  const hs = tray.start(items.map((i) => ({ name: i.name, size: i.blob.size })));
  try {
    const ids = await source.upload(items, { onProgress: (a, b) => hs.forEach((h) => h.progress(b ? a / b : 0)) });
    hs.forEach((h) => h.done());
    if (!S.demo) S.meta = await loadFileMeta().catch(() => S.meta);
    return ids;
  } catch (e) { hs.forEach((h) => h.fail(uploadWhy(e))); return null; }
}

/** Several new files (the parts of a split PDF) next to the original, in one step. */
async function saveMany(f, parts) {
  const ids = await uploadAll(parts.map((p) => ({ blob: p.blob, name: p.name })));
  if (!ids) return false;
  const col = f.readOnly ? fileColumn() : null;
  const target = col ? { ...f, col: col.id, index: attachmentIds(cellOf(f.rowId, col.id)).length - 1 } : f;
  return write(insertManyAfter(S.tableId, target, cellOf(f.rowId, target.col), ids), tn(ids.length, 'Saved {n} new file next to the original.', 'Saved {n} new files next to the original.'));
}

/** PDFs and pictures to add pages from: the ones in this document, or from the computer. */
async function pickMore(exclude, host = shell) {
  const seen = new Set([exclude?.attId]);
  const candidates = (S.gallery?.files || []).filter((x) => mergeable(x) && !seen.has(x.attId) && seen.add(x.attId))
    .map((x) => ({ key: x.key, name: x.name, ext: x.ext, size: x.size, where: x.recordTitle, file: x }));
  const r = await chooseFiles(host, { title: t('Add pages from other files'), body: t('PDFs and pictures. Every page of each file is added.'), candidates });
  if (!r) return null;
  const out = [];
  for (const c of r.picked) out.push({ name: c.name, blob: await source.blob(c.file) });
  for (const file of r.files) out.push({ name: file.name, blob: file });
  return out;
}

/** The PDF editor over a set of files: every page of them in order, to reorder or drop, then saved as one new PDF. */
async function openMergeEditor(first, entries) {
  const opts = {
    file: first, source, culture: gristCulture(),
    canSave: false, canCopy: canEdit() && (!first.readOnly || !!fileColumn()),
    merge: { files: entries, name: `${baseOf(first.name)} (${t('merged')}).pdf` },
    onSave: (blob, o) => saveEdited(first, blob, o),
    onSaveMany: (parts, o) => saveMany(first, parts, o),
    pickFiles: (host) => pickMore(null, host),
  };
  try { (await import('./views/pdfeditor.js')).openPdfEditor(shell, opts); }
  catch (e) { toast(t('The editor did not open: {why}', { why: errText(e) })); }
}
/** The marked PDFs and pictures, merged. */
async function mergeFiles(files) {
  const list = files.filter(mergeable);
  if (list.length < 2) { toast(t('Merging needs at least two PDFs or pictures.')); return; }
  if (list.length < files.length) toast(tn(files.length - list.length, '{n} other file is left out: only PDFs and pictures merge.', '{n} other files are left out: only PDFs and pictures merge.'));
  await openMergeEditor(list[0], list.map((x) => ({ name: x.name, file: x })));
}
/** "Merge with…" on one file: choose the others, then the same editor. */
async function mergeWith(f) {
  const more = await pickMore(f);
  if (!more?.length) return;
  await openMergeEditor(f, [{ name: f.name, file: f }, ...more.map((m) => ({ name: m.name, blob: m.blob }))]);
}

/**
 * Save an edited file. mode 'replace': the new version takes the original's place (and, if the person
 * says so, every other place the original is in); 'copy': next to the original; 'download': only to
 * the computer. Resolves true when it was saved.
 */
async function saveEdited(f, blob, { mode, name, pause, removeOriginals = null }) {
  if (mode === 'download') { saveBlob(blob, name || f.name); return true; }
  // Ask about the other places before uploading, so a cancelled save leaves no stray attachment.
  let places = [], everywhere = false;
  if (mode === 'replace') {
    places = await placesOf(f).catch(() => []);
    // Formula cells are not asked about: they follow their formula by themselves.
    const others = places.filter((p) => !p.isFormula && !(p.tableId === S.tableId && p.rowId === f.rowId && p.colId === f.col));
    if (others.length) {
      pause?.(true);
      const choice = await choiceBox(shell, {
        title: tn(others.length, 'This file is in {n} more place', 'This file is in {n} more places'),
        body: t('The other places still show the old version. Should they get the new one too?'),
        choices: [[t('Update every place'), 'all', t('One step, which Undo takes back.')], [t('Only this record'), 'one']],
      });
      pause?.(false);
      if (!choice) return false;
      everywhere = choice === 'all';
    }
  }
  const id = await uploadOne(blob, name || f.name);
  if (id == null) return false;
  if (mode === 'copy') {
    const col = f.readOnly ? fileColumn() : null;
    const target = col ? { ...f, col: col.id, index: attachmentIds(cellOf(f.rowId, col.id)).length - 1 } : f;
    // A merged file may also take the files it was made from out of their records, in the same step.
    const gone = (removeOriginals || []).map((x) => x.file).filter((x) => x && canEditFile(x));
    const actions = gone.length ? mergeResult(S.tableId, target, id, gone, cellOf) : insertAfter(S.tableId, target, cellOf(f.rowId, target.col), id);
    return write(actions, t('Saved “{name}” as a copy.', { name: name || f.name }));
  }
  let actions = replaceFile(S.tableId, f, cellOf(f.rowId, f.col), id);
  const carried = carryNotes(NOTES.map, [[identOf(f), S.meta.get(id)?.ident]]);
  if (everywhere) {
    locs = null;   // read the cells again: the question may have stood open while another table changed
    const L = await locationsIndex();
    actions = replaceEverywhere(L.index.get(f.attId) || places, f.attId, id, (tableId, rowId, colId) => (tableId === S.tableId ? cellOf(rowId, colId) : L.tables.get(tableId)?.rows.get(rowId)?.[colId]));
  }
  return writeNotes([...actions, ...carried], t('Saved “{name}”.', { name: name || f.name }));
}

async function duplicate(f) {
  if (!canEditFile(f)) { toast(readOnlyWhy() || t('This file comes from a formula column.')); return; }
  try {
    const blob = await source.blob(f);
    const name = `${baseOf(f.name)} (${t('copy')})${f.ext ? '.' + f.ext : ''}`;
    const id = await uploadOne(blob, name);
    if (id != null) await write(insertAfter(S.tableId, f, cellOf(f.rowId, f.col), id), t('Duplicated as “{name}”.', { name }));
  } catch (e) { toast(t('The file could not be copied: {why}', { why: errText(e) })); }
}

/** Copy or move files to a record picked from a list (or dropped on). */
async function sendTo(files, mode, targetRowId = null) {
  const movable = mode === 'move' ? files.filter(canEditFile) : files;
  if (!movable.length || !canEdit()) { toast(readOnlyWhy() || t('These files come from formula columns and cannot be moved here.')); return; }
  if (targetRowId == null) {
    const from = new Set(movable.map((f) => f.rowId));
    targetRowId = await pickRecord(shell, {
      title: mode === 'move' ? tn(movable.length, 'Move {n} file to…', 'Move {n} files to…') : tn(movable.length, 'Copy {n} file to…', 'Copy {n} files to…'),
      body: mode === 'move' ? t('The files leave their record and go into the one you pick.') : t('The same files will also be in the record you pick.'),
      records: S.gallery.records, exclude: from.size === 1 ? from : new Set(),
    });
    if (targetRowId == null) return;
  }
  // Each file goes to the same column in the target, unless that column is a formula.
  const byCol = new Map();
  for (const f of movable) {
    const col = S.columns.find((c) => c.id === f.col && !c.isFormula) || fileColumn();
    if (!col) continue;
    if (!byCol.has(col.id)) byCol.set(col.id, []);
    byCol.get(col.id).push(f);
  }
  const actions = [];
  for (const [col, list] of byCol) {
    actions.push(...(mode === 'move' ? moveFilesTo(S.tableId, list, targetRowId, col, cellOf) : copyFilesTo(S.tableId, list, targetRowId, col, cellOf(targetRowId, col))));
  }
  const to = recordOf(targetRowId)?.title || t('the record');
  if (!actions.length) { toast(t('Those files are in {record} already.', { record: to })); return; }
  clearMarks(false);
  return write(actions, mode === 'move' ? tn(movable.length, 'Moved {n} file to {record}.', 'Moved {n} files to {record}.').replace('{record}', to)
    : tn(movable.length, 'Copied {n} file to {record}.', 'Copied {n} files to {record}.').replace('{record}', to));
}

const replacer = el('input', { type: 'file', hidden: true });
shell.append(replacer);
function replaceWith(f) {
  if (!canEditFile(f)) { toast(readOnlyWhy() || t('This file comes from a formula column.')); return; }
  replacer.value = '';
  replacer.onchange = async () => {
    const file = replacer.files[0];
    if (!file) return;
    const id = await uploadOne(file, file.name);
    if (id != null) await writeNotes([...replaceFile(S.tableId, f, cellOf(f.rowId, f.col), id), ...carryNotes(NOTES.map, [[identOf(f), S.meta.get(id)?.ident]])], t('Replaced “{old}” with “{name}”.', { old: f.name, name: file.name }));
  };
  replacer.click();
}

// ---- where it is ---------------------------------------------------------------------------------------------------
let locs = null, locsAt = 0;
/** Every Attachments cell of the document (read on demand, kept for 20 s; in the demo, its one table). */
async function locationsIndex() {
  if (S.demo) {
    const columns = S.columns.filter((c) => c.kind === 'Attachments').map((c) => ({ tableId: S.tableId, colId: c.id, colRef: c.ref, label: c.label, isFormula: c.isFormula }));
    return { index: buildIndex(columns, [{ tableId: S.tableId, rows: S.rows }]), tables: new Map([[S.tableId, { columns: S.columns, rows: new Map(S.rows.map((r) => [r.id, r])) }]]), placeOf: () => null };
  }
  if (!locs || Date.now() - locsAt > 20000) { locs = await loadLocations(); locsAt = Date.now(); }
  return locs;
}
/** The places a file is in, with the row's title, the column's label and a link to the cell. */
async function placesOf(f) {
  const L = await locationsIndex();
  const url = S.demo ? null : await docUrl();
  return (L.index.get(f.attId) || []).map((p) => {
    const tb = L.tables.get(p.tableId);
    const own = p.tableId === S.tableId;
    const row = own ? rowOf(p.rowId) || tb?.rows.get(p.rowId) : tb?.rows.get(p.rowId);
    const cols = own ? S.columns : tb?.columns || [];
    const titleId = own ? S.roles.title : detectRoles(cols).title;
    const titleCol = cols.find((c) => c.id === titleId);
    return {
      ...p,
      tableLabel: p.tableId.replace(/_/g, ' '),
      colLabel: cols.find((c) => c.id === p.colId)?.label || p.colId,
      rowTitle: row && titleCol ? cellText(row[titleCol.id], titleCol, own ? S.labels[titleCol.id] : null, fmt()) : null,
      link: cellLink(url, L.placeOf(p.tableId), { rowId: p.rowId, colRef: p.colRef }),
      here: own && p.rowId === f.rowId && p.colId === f.col,
    };
  });
}
async function showRow(p) {
  const L = await locationsIndex();
  const own = p.tableId === S.tableId;
  const row = own ? rowOf(p.rowId) || L.tables.get(p.tableId)?.rows.get(p.rowId) : L.tables.get(p.tableId)?.rows.get(p.rowId);
  if (!row) { toast(t('That row is gone.')); return; }
  const columns = own ? S.columns : L.tables.get(p.tableId)?.columns || [];
  const labels = own ? S.labels : await loadLabels(columns, columns.filter((c) => c.refTable).map((c) => c.id)).catch(() => ({}));
  openRowCard(shell, {
    title: p.rowTitle || t('Row {id}', { id: p.rowId }), subtitle: `${p.tableLabel} · ${t('Row {id}', { id: p.rowId })}`,
    row, columns, labels, fmt: fmt(), link: p.link,
    fileName: (id) => S.meta.get(id)?.name || `#${id}`,
    onOpenFile: own ? (id) => { const file = recordOf(p.rowId)?.files.find((x) => x.attId === id); if (file) openFile(file, null, p.rowId); } : null,
  });
}
async function showPlaces(f) {
  const places = await placesOf(f).catch((e) => { toast(t('Could not read the document: {why}', { why: errText(e) })); return null; });
  if (!places) return;
  placesDialog(shell, { title: f.name, places, onRow: (p) => showRow(p) });
}

// ---- writing ---------------------------------------------------------------------------------------------------
async function write(actions, done) {
  if (!actions || !actions.length) return false;
  locs = null;   // the cells changed: "where it is" reads them again next time
  if (S.demo) {
    demoHistory.undo.push(demoSnapshot());
    demoHistory.redo = [];
    applyDemo(actions);
    rebuild(); render();
    if (done) toast(done, { label: t('Undo'), run: () => undo() });
    return true;
  }
  try {
    await apply(actions);
    if (actions.some((a) => a[1] === '_grist_Attachments')) await reloadMeta();
    if (done) toast(done, { label: t('Undo'), run: () => undo() });
    return true;
  } catch (e) {
    toast(t('Grist refused the change: {why}', { why: errText(e) }));
    return false;
  }
}
function demoNotesApply(kind, id, fields) {
  const rows = demoNotes.rows;
  const blank = () => ({ id: demoNotes.next++, Ident: '', Name: '', Tags: null, Note: '' });
  if (kind === 'AddRecord') rows.push({ ...blank(), ...fields });
  else if (kind === 'BulkAddRecord') id.forEach((_, i) => rows.push({ ...blank(), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[i]])) }));
  else if (kind === 'UpdateRecord') { const r = rows.find((x) => x.id === id); if (r) Object.assign(r, fields); }
  else if (kind === 'RemoveRecord') { const k = rows.findIndex((x) => x.id === id); if (k >= 0) rows.splice(k, 1); }
}
const demoSnapshot = () => ({ rows: JSON.parse(JSON.stringify(S.rows)), meta: new Map([...S.meta].map(([k, v]) => [k, { ...v }])), notes: JSON.parse(JSON.stringify(demoNotes)) });
function demoRestore(snap) {
  S.rows = snap.rows; S.meta = snap.meta;
  Object.assign(demoNotes, snap.notes);
  loadNotes();
}
function applyDemo(actions) {
  for (const [kind, table, id, fields] of actions) {
    if (kind === 'AddTable') { if (table === NOTES_TABLE) demoNotes.exists = true; continue; }
    if (table === NOTES_TABLE) { demoNotesApply(kind, id, fields); continue; }
    if (table === '_grist_Attachments') {
      const ids = Array.isArray(id) ? id : [id];
      ids.forEach((x, i) => { const m = S.meta.get(x); if (m && fields.fileName) { const name = Array.isArray(id) ? fields.fileName[i] : fields.fileName; S.meta.set(x, { ...m, name, ext: extOf(name) || m.ext }); } });
    } else if (kind === 'UpdateRecord') { const r = rowOf(id); if (r) Object.assign(r, fields); }
    else if (kind === 'AddRecord') {
      const r = { id: Math.max(0, ...S.rows.map((x) => x.id)) + 1 };
      for (const c of S.columns) r[c.id] = null;
      S.rows.push(Object.assign(r, fields));
    }
    else if (kind === 'BulkAddRecord') {
      let next = Math.max(0, ...S.rows.map((r) => r.id)) + 1;
      id.forEach((_, i) => { const r = { id: next++ }; for (const c of S.columns) r[c.id] = null; for (const [k, list] of Object.entries(fields)) r[k] = list[i]; S.rows.push(r); });
    }
  }
}
async function undo() {
  if (S.demo) {
    const last = demoHistory.undo.pop();
    if (!last) return;
    demoHistory.redo.push(demoSnapshot());
    demoRestore(last); rebuild(); render();
    return;
  }
  await gristUndo();
  await reloadMeta();
  await loadNotes(); render();
}
async function redo() {
  if (S.demo) {
    const next = demoHistory.redo.pop();
    if (!next) return;
    demoHistory.undo.push(demoSnapshot());
    demoRestore(next); rebuild(); render();
    return;
  }
  await gristRedo();
  await reloadMeta();
  await loadNotes(); render();
}
async function reloadMeta() {
  if (S.demo) return;
  try { S.meta = await loadFileMeta(); rebuild(); render(); } catch { /* next time */ }
}

async function removeOne(f) {
  if (!canEditFile(f)) { toast(f.readOnly ? t('This file comes from a formula column and cannot be removed here.') : readOnlyWhy()); return; }
  const actions = removeFile(S.tableId, f, cellOf(f.rowId, f.col));
  if (!actions) return;
  S.marked.delete(f.key);
  await write(actions, t('Removed “{name}” from {record}.', { name: f.name, record: f.recordTitle || t('the record') }));
}
/** The file out of every cell in the document that holds it (the cells "Where it is" lists), after a question. */
async function removeEverywhereAsk(f) {
  if (!canEdit()) { toast(readOnlyWhy()); return; }
  const places = await placesOf(f).catch((e) => { toast(t('Could not read the document: {why}', { why: errText(e) })); return null; });
  if (!places) return;
  const open = places.filter((p) => !p.isFormula);
  if (!open.length) { toast(t('This file comes from a formula column and cannot be removed here.')); return; }
  const listed = open.slice(0, 6).map((p) => `${p.rowTitle || t('Row {id}', { id: p.rowId })} · ${p.tableLabel} › ${p.colLabel}`);
  if (open.length > listed.length) listed.push(t('and {n} more', { n: open.length - listed.length }));
  const formulas = places.length - open.length;
  const ok = await confirmBox(shell, {
    title: t(open.length === 1 ? 'Remove “{name}” from {n} place?' : 'Remove “{name}” from {n} places?', { name: f.name, n: open.length }),
    body: t('It leaves these cells in one step, which Undo takes back. Grist keeps the file for a while, then deletes it.')
      + (formulas ? ' ' + tn(formulas, '{n} place in a formula column follows its formula.', '{n} places in formula columns follow their formulas.') : ''),
    items: listed,
    ok: t('Remove everywhere'), danger: true,
  });
  if (!ok) return;
  // Read the cells again: another table may have changed since the list was made.
  locs = null;
  const L = await locationsIndex();
  const fresh = (L.index.get(f.attId) || []).filter((p) => !p.isFormula);
  const actions = removeEverywhere(fresh, f.attId, (tableId, rowId, colId) => (tableId === S.tableId ? cellOf(rowId, colId) : L.tables.get(tableId)?.rows.get(rowId)?.[colId]));
  if (!actions.length) return;
  S.marked.delete(f.key);
  await write(actions, t(actions.length === 1 ? 'Removed “{name}” from {n} place.' : 'Removed “{name}” from {n} places.', { name: f.name, n: actions.length }));
}
// ---- storage: where the space goes, shrinking photos, freeing what nobody uses ----------------------------------
// The demo has two leftover files so the view has something to show; "Free up space" there just forgets them.
let demoUnused = [
  { id: 9001, fileName: 'old-draft.pdf', fileExt: 'pdf', fileSize: 640000, fileIdent: 'demo-unused-1', timeDeleted: null },
  { id: 9002, fileName: 'rejected-photo.jpg', fileExt: 'jpg', fileSize: 2100000, fileIdent: 'demo-unused-2', imageWidth: 4000, imageHeight: 3000, timeDeleted: null },
];
let storageUI = null;

function demoAttachmentRows() {
  return [...S.meta.values()].map((m) => ({ id: m.id, fileName: m.name, fileExt: m.ext, fileSize: m.size, fileIdent: m.ident, imageWidth: m.w, imageHeight: m.h, timeUploaded: m.uploaded, timeDeleted: null })).concat(demoUnused);
}

async function openStorage() {
  if (storageUI) return;
  let key = 'demo';
  if (!S.demo) { try { key = (await docUrl()) || 'live'; } catch { key = 'live'; } }
  storageUI = openLibrary(shell, {
    canWrite: canEdit(),
    limitKey: key,
    load: async () => {
      locs = null;
      const L = await locationsIndex();
      const rows = S.demo ? demoAttachmentRows() : await loadAttachmentRows();
      const info = S.demo ? { access: 'owners', store: 'internal', host: '' } : await storageInfo();
      return { rows, usesOf: (id) => L.index.get(id) || [], info };
    },
    onShrink: shrinkPhotosInDocument,
    onFree: async () => {
      if (S.demo) { demoUnused = []; return { ok: true }; }
      const r = await freeUnusedFiles();
      S.meta = await loadFileMeta().catch(() => S.meta);
      return r;
    },
    onWhere: async (b) => {
      const all = [];
      for (const id of b.ids) all.push(...(await placesOf({ attId: id, rowId: -1, col: '' })));
      placesDialog(shell, { title: b.name, places: all, onRow: (p) => showRow(p) });
    },
    onDownload: (b) => downloadFile({ attId: b.id, name: b.name, ext: b.ext, size: b.size }),
    onRemove: (b) => removeContentEverywhere(b),
    onClose: () => { storageUI = null; },
  });
}

/** Photos redrawn smaller, the old file replaced by the new one in every cell that holds it, as ONE Grist action. */
async function shrinkPhotosInDocument(cands, { maxSide }, { onProgress, signal }) {
  const mapping = new Map();
  let saved = 0, failed = 0, done = 0;
  const work = async (c) => {
    try {
      const blob = await source.blob({ attId: c.id, name: c.name, ext: c.ext });
      const file = new File([blob], c.name, { type: blob.type });
      const small = await shrinkPhoto(file, maxSide);
      if (small === file || small.size >= file.size) return null;   // nothing to gain: left as it is
      const [id] = await source.upload([{ blob: small, name: small.name }]);
      return { c, id, gain: file.size - small.size };
    } catch { failed++; return null; }
  };
  const step = 2;   // two at a time: a 12-megapixel photo is 48 MB once decoded
  for (let i = 0; i < cands.length && !signal.aborted; i += step) {
    for (const r of await Promise.all(cands.slice(i, i + step).map(work))) {
      if (!r) continue;
      for (const id of r.c.ids) mapping.set(id, r.id);
      saved += r.gain; done++;
    }
    onProgress(Math.min(cands.length, i + step), cands.length, saved);
  }
  if (mapping.size) {
    locs = null;
    const L = await locationsIndex();
    const actions = replaceMany((id) => L.index.get(id), mapping, (tableId, rowId, colId) => (tableId === S.tableId ? cellOf(rowId, colId) : L.tables.get(tableId)?.rows.get(rowId)?.[colId]));
    if (!S.demo) S.meta = await loadFileMeta().catch(() => S.meta);
    const carried = carryNotes(NOTES.map, [...mapping].map(([from, to]) => [S.meta.get(from)?.ident, S.meta.get(to)?.ident]));
    if (actions.length) await writeNotes([...actions, ...carried], tn(done, 'Shrunk {n} photo.', 'Shrunk {n} photos.'));
    if (!S.demo) S.meta = await loadFileMeta().catch(() => S.meta);
  }
  return { done, failed, saved };
}

/** One content out of every cell in the document that holds it (asks first, lists where). */
async function removeContentEverywhere(b) {
  if (!canEdit()) { toast(readOnlyWhy()); return false; }
  const L = await locationsIndex();
  const all = [];
  for (const id of b.ids) all.push(...(await placesOf({ attId: id, rowId: -1, col: '' })));
  const open = all.filter((p) => !p.isFormula);
  if (!open.length) { toast(t('This file comes from a formula column and cannot be removed here.')); return false; }
  const listed = open.slice(0, 6).map((p) => `${p.rowTitle || t('Row {id}', { id: p.rowId })} · ${p.tableLabel} › ${p.colLabel}`);
  if (open.length > listed.length) listed.push(t('and {n} more', { n: open.length - listed.length }));
  const ok = await confirmBox(shell, {
    title: t(open.length === 1 ? 'Remove “{name}” from {n} place?' : 'Remove “{name}” from {n} places?', { name: b.name, n: open.length }),
    body: t('It leaves these cells in one step, which Undo takes back. Grist keeps the file for a while, then deletes it.'),
    items: listed, ok: t('Remove everywhere'), danger: true,
  });
  if (!ok) return false;
  const actions = removeManyEverywhere((id) => L.index.get(id), b.ids, (tableId, rowId, colId) => (tableId === S.tableId ? cellOf(rowId, colId) : L.tables.get(tableId)?.rows.get(rowId)?.[colId]));
  if (!actions.length) return false;
  return write(actions, t(actions.length === 1 ? 'Removed “{name}” from {n} place.' : 'Removed “{name}” from {n} places.', { name: b.name, n: actions.length }));
}

async function removeMany(files) {
  const can = files.filter(canEditFile);
  if (!can.length) { toast(readOnlyWhy() || t('These files come from formula columns and cannot be removed here.')); return; }
  const ok = await confirmBox(shell, {
    title: tn(can.length, 'Remove {n} file from its record?', 'Remove {n} files from their records?'),
    body: t('The files leave their records in one step, which Undo takes back. Grist deletes files no record uses after a while.'),
    ok: t('Remove'), danger: true,
  });
  if (!ok) return;
  const actions = removeFiles(S.tableId, can, cellOf);
  clearMarks(false);
  await write(actions, tn(can.length, 'Removed {n} file.', 'Removed {n} files.'));
}
async function reorder(f, to) {
  if (!canEditFile(f)) { toast(readOnlyWhy() || t('This file comes from a formula column.')); return; }
  const actions = moveFile(S.tableId, f, cellOf(f.rowId, f.col), to);
  if (!actions) { render(); return; }
  await write(actions, to === 0 ? t('“{name}” is now the cover.', { name: f.name }) : null);
}
async function renameOne(f) {
  if (!canRename(f)) { toast(readOnlyWhy()); return; }
  const base = baseOf(f.name);
  const name = await textBox(shell, {
    title: t('Rename file'), label: t('File name'), value: f.name, select: [0, base.length],
    body: t('The new name shows everywhere this file is used in the document.'),
    check: (v) => (safeName(v) !== v ? t('A name cannot contain / : * ? " < > | or a backslash.') : null),
  });
  if (!name || name === f.name) return;
  const withExt = extOf(name) ? name : name + (f.ext ? '.' + f.ext : '');
  await write(renameFiles([{ attId: f.attId, name: withExt }]), t('Renamed to “{name}”.', { name: withExt }));
}

async function renameMany(files) {
  if (!files.length) return;
  if (!canEdit()) { toast(readOnlyWhy()); return; }
  const list = await renameBox(shell, { items: exportItems(files), pattern: S.settings.zip.pattern === '{file}' ? '{record} {nn}' : S.settings.zip.pattern, columns: S.columns, textOf });
  if (!list) return;
  if (!list.length) { toast(t('The names are the same already.')); return; }
  await write(renameFiles(list.map((x) => ({ attId: x.attId, name: x.name }))), tn(list.length, 'Renamed {n} file.', 'Renamed {n} files.'));
}

// ---- adding files ------------------------------------------------------------------------------------------------
// One file picker for everything: on a phone it already offers the camera next to the photo library,
// so there is no separate "Take photo" button to keep in step with it.
function pickFiles(rowId) {
  if (!canEdit()) { toast(readOnlyWhy()); return; }
  const input = picker;
  input.value = '';
  input.onchange = () => { const files = [...input.files]; if (files.length) addFiles(files, rowId ?? null, { picked: true }); };
  input.click();
}

/**
 * Upload files and put them in a record (rowId), or make one new record per file (rowId null and the
 * person chooses so, or there is no record to add them to).
 */
async function addFiles(files, rowId, { picked = false } = {}) {
  if (!files.length) return;
  if (!canEdit()) { toast(readOnlyWhy()); return; }
  const col = fileColumn();
  if (!col) { toast(S.roles.files.length ? t('The files columns here are formulas: files cannot be added to them.') : t('Add an Attachments column first.')); return; }
  let asNew = false;
  if (rowId == null) {
    const cur = recordOf(S.current);
    const title = tn(files.length, 'Add {n} file', 'Add {n} files');
    const choice = await choiceBox(shell, {
      title,
      choices: [
        ...(cur ? [[t('Add to “{name}”', { name: cur.title || t('the selected record') }), 'current', tn(files.length, 'The file goes into this record’s {col}.', 'The files go into this record’s {col}.').replace('{col}', col.label)]] : []),
        [tn(files.length, 'Make a new record for it', 'Make a new record for each'), 'new', t('Named after the file. Good for importing a folder of photos.')],
      ],
    });
    if (!choice) return;
    if (choice === 'current') rowId = cur.rowId; else asNew = true;
  }
  const target = rowId != null ? recordOf(rowId) : null;
  if (rowId != null && !rowOf(rowId)) { toast(t('That record is no longer shown here.')); return; }

  let list = files;
  if (S.settings.upload.shrink) list = await Promise.all(files.map((f) => shrinkPhoto(f, S.settings.upload.maxSide).catch(() => f)));
  const handles = tray.start(list);
  const done = [];
  // Two uploads at a time, each file its own request: a failure costs that file only, and progress is per file.
  let next = 0;
  const work = async () => {
    while (next < list.length) {
      const k = next++;
      const f = list[k];
      try {
        const ids = await source.upload([f], { onProgress: (a, b) => handles[k].progress(b ? a / b : 0) });
        done.push({ k, id: ids[0], name: f.name });
        handles[k].done();
      } catch (e) {
        handles[k].fail(uploadWhy(e));
      }
    }
  };
  await Promise.all([work(), work()]);
  if (!done.length) return;
  done.sort((a, b) => a.k - b.k);
  if (!S.demo) S.meta = await loadFileMeta().catch(() => S.meta);
  const titleCol = S.columns.find((c) => c.id === S.roles.title) || null;
  const actions = asNew
    ? newRecords(S.tableId, done.map((d) => ({ id: d.id, name: d.name })), { titleCol, filesCol: col.id, prefill: linkPrefill() })
    : addFilesActions(S.tableId, rowId, col.id, cellOf(rowId, col.id), done.map((d) => d.id));
  const ok = await write(actions, asNew
    ? tn(done.length, 'Made {n} new record.', 'Made {n} new records.')
    : tn(done.length, 'Added {n} file to {record}.', 'Added {n} files to {record}.').replace('{record}', target?.title || t('the record')));
  if (ok && !asNew) announce(t('Files added'));
}
function uploadWhy(e) {
  if (e?.blocked) return t('The Grist server refused the upload from a widget (CORS). Add the file in the Grist cell instead, or ask the server’s administrator.');
  if (e?.status === 413) return t('The file is larger than this Grist allows.');
  if (e?.status === 403) return t('You may not add files to this document.');
  return errText(e) || t('Upload failed.');
}
/** The value new records need so they show under the current Select-by selection. */
function linkPrefill() {
  const col = S.ownSection?.linkTargetColId;
  if (!col || !linkingInfo()?.asTarget) return null;
  const value = sharedValue(S.rows, col);
  return value == null ? null : { col, value };
}
async function addFilesColumn() {
  if (!canEdit()) return;
  const id = S.columns.some((c) => c.id === 'Files') ? 'Attachments' : 'Files';
  try {
    await apply([['AddColumn', S.tableId, id, { type: 'Attachments' }]]);
    forgetMeta();
    S.columns = await loadColumns(S.tableId);
    S.roles = resolveRoles(S.settings.roles, S.columns);
    rebuild(); render();
    toast(t('Added the column “{id}”. Drop files on a card to fill it.', { id }));
  } catch (e) { toast(t('Grist refused the change: {why}', { why: errText(e) })); }
}

// ---- getting files out ---------------------------------------------------------------------------------------------
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function downloadFile(f) {
  try {
    if (S.demo) { saveBlob(await source.blob(f), f.name); return; }
    // Grist sends the file as an attachment under the name asked for: the browser saves it, the page stays.
    const a = el('a', { href: await fileUrl(f.attId, { name: f.name }), rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { toast(t('The download did not start: {why}', { why: errText(e) })); }
}
async function openInTab(f) {
  try {
    const w = window.open(await source.url(f, { inline: true }), '_blank', 'noopener');
    if (!w && !S.demo) toast(t('The browser blocked the new tab.'));
  } catch (e) { toast(errText(e)); }
}
function downloadMenu(anchor) {
  const rec = recordOf(S.current);
  const shown = V().layout === 'files' ? shownFiles() : (S.gallery?.files || []);
  openMenu(shell, anchor, [
    [rec ? t('Files of “{name}” as zip', { name: rec.title || t('this record') }) : t('Files of the selected record as zip'), () => zipRecord(S.current), { disabled: !rec?.files.length }],
    [tn(shown.length, 'The {n} file shown, as zip', 'All {n} files shown, as zip'), () => zipFiles(shown, S.tableId || DEMO_TABLE), { disabled: !shown.length }],
    S.marked.size ? [tn(S.marked.size, 'The {n} marked file, as zip', 'The {n} marked files, as zip'), () => zipFiles(markedFiles(), t('Marked files'))] : null,
    null,
    [rec ? t('Photo report of “{name}”…', { name: rec.title || t('this record') }) : t('Photo report of the selected record…'), () => photoReport(rec.files, rec), { disabled: !rec?.files.some((f) => REPORT_PICTURE.test(f.ext)), hint: t('The photos on pages with the record’s details, as a PDF') }],
    S.marked.size && markedFiles().some((f) => REPORT_PICTURE.test(f.ext)) ? [t('Photo report of the marked files…'), () => photoReport(markedFiles(), null)] : null,
    null,
    [t('How zip files are named…'), () => openColumnsPanel()],
  ].filter((x, i, a) => !(x === null && a[i - 1] === null)));
}
const zipRecord = (rowId) => { const rec = recordOf(rowId); if (rec?.files.length) zipFiles(rec.files, rec.title || `Record ${rec.rowId}`); };

/** Files with their record and their place in it (n), so {n} counts per record in names. */
function exportItems(files) {
  const seen = new Map();
  return files.map((f) => { const n = (seen.get(f.rowId) || 0) + 1; seen.set(f.rowId, n); return { file: f, record: recordOf(f.rowId) || { rowId: f.rowId, title: f.recordTitle }, n }; });
}

let zipping = false;
async function zipFiles(files, name) {
  if (!files.length || zipping) return;
  const total = files.reduce((n, f) => n + (f.size || 0), 0);
  if (total > ZIP_LIMIT * 0.98) { toast(t('These files are {size} together, more than a zip can hold (4 GB). Mark fewer files.', { size: sizeText(total, uiLang()) })); return; }
  zipping = true;
  const cfg = S.settings.zip;
  const items = exportItems(files);
  const paths = exportPaths(items, { pattern: cfg.pattern, folders: cfg.folders, folderPattern: cfg.folderPattern, columns: S.columns, textOf });
  const entries = [];
  const failed = [];
  let got = 0;
  toast(t('Preparing the zip: {done} of {n} files…', { done: 0, n: files.length }), null, 0);
  let next = 0;
  const work = async () => {
    while (next < paths.length) {
      const k = next++;
      const { file, path } = paths[k];
      try { entries[k] = { path, blob: await source.blob(file), date: file.uploaded ? new Date(file.uploaded) : new Date() }; }
      catch { failed.push(file.name); }
      got++;
      toast(t('Preparing the zip: {done} of {n} files…', { done: got, n: files.length }), null, 0);
    }
  };
  try {
    await Promise.all([work(), work(), work()]);
    const list = entries.filter(Boolean);
    if (cfg.manifest) {
      const header = [t('File in zip'), t('Original name'), t('Record'), t('Row id'), t('Column'), t('Size (bytes)'), t('Uploaded')];
      const rows = paths.filter((_, k) => entries[k]).map(({ file, path }) => [path, file.name, file.recordTitle, file.rowId, file.colLabel || file.col, file.size, file.uploaded ? new Date(file.uploaded).toISOString() : '']);
      list.push({ path: 'files.csv', blob: new Blob([manifestCsv(rows, header)], { type: 'text/csv' }) });
    }
    const zip = await makeZip(list);
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // the person's own date, not UTC
    saveBlob(zip, `${safeName(name) || 'files'} ${day}.zip`);
    toast(failed.length ? t('Zip saved without {n} files that could not be read: {names}', { n: failed.length, names: failed.slice(0, 3).join(', ') }) : tn(list.length - (cfg.manifest ? 1 : 0), 'Zip with {n} file saved.', 'Zip with {n} files saved.'));
  } catch (e) {
    toast(t('The zip could not be made: {why}', { why: errText(e) }));
  } finally { zipping = false; }
}

// ---- the Columns panel ---------------------------------------------------------------------------------------------
function openColumnsPanel() {
  const first = S.gallery?.files[0];
  openColumns(shell, {
    columns: S.columns, roles: S.roles, settings: S.settings, editable: canEdit(), demo: S.demo, readOnlyWhy: readOnlyWhy(),
    sample: first ? { file: first, record: recordOf(first.rowId) || { rowId: first.rowId, title: first.recordTitle }, textOf } : null,
    onAddColumn: () => addFilesColumn(),
    onSave: async ({ roles, settings, language }) => {
      if (language !== storedLanguage()) { setLanguage(language); location.reload(); return; }
      S.roles = { ...roles, source: 'saved' };
      S.settings = { ...settings, roles: toStored(roles, S.columns) };
      // A saved layout is what everyone opens in; this browser's own switch goes back to following it.
      setView({ layout: null, cardSize: null, fileSize: null, fit: null, grouped: null, captions: null, cover: null });
      writeView(S.tableId, { layout: null, cardSize: null, fileSize: null, fit: null, grouped: null, captions: null, cover: null });
      if (!S.demo) {
        try { await setOptions(writeOptions(settings, toStored(roles, S.columns))); }
        catch (e) { toast(t('Grist refused the change: {why}', { why: errText(e) })); }
        S.labels = await loadLabels(S.columns, [S.roles.title, ...S.roles.fields].filter(Boolean)).catch(() => S.labels);
      }
      rebuild(); render();
    },
  });
}

// ---- keyboard and clipboard ------------------------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (S.lb || e.target.closest?.('.gs-dialog, .gs-drawer, .gs-menu')) return;
  const typing = e.target.closest?.('input, textarea, select');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openFinder(); return; }
  if (mod && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && !typing && e.key === 'y') { e.preventDefault(); redo(); return; }
  if (mod && !typing && !e.shiftKey && !e.altKey && V().layout === 'files' && (e.key === 'x' || e.key === 'X' || e.key === 'c' || e.key === 'C')) {
    const list = focusedFiles();
    if (list.length) { e.preventDefault(); setClip(list, e.key.toLowerCase() === 'x' ? 'cut' : 'copy'); }
    return;
  }
  if (typing) return;
  if (e.key === '/' && !mod) { e.preventDefault(); bars.focusSearch(); }
  else if (e.key === '?') { e.preventDefault(); openKeys(shell); }
  else if (e.altKey && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); setView({ layout: ['cards', 'files', 'viewer'][Number(e.key) - 1] }); clearMarks(false); render(); }
  else if (e.key === 'Escape' && (S.marked.size || S.clip)) { e.preventDefault(); if (S.clip) dropClip(); if (S.marked.size) clearMarks(); }
});
document.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea') || S.lb) return;
  const files = [...(e.clipboardData?.files || [])];
  // Nothing from the computer's clipboard, but files cut or copied here: paste them into the selected record.
  if (!files.length) { if (S.clip && V().layout !== 'viewer') { e.preventDefault(); pasteClip(S.current); } return; }
  e.preventDefault();
  // A pasted screenshot is called "image.png" by every browser: give it a name worth keeping.
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
  const named = files.map((f, i) => (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? new File([f], `${t('Screenshot')} ${stamp}${files.length > 1 ? ' ' + (i + 1) : ''}.${extOf(f.name)}`, { type: f.type }) : f));
  addFiles(named, V().layout === 'viewer' ? S.current : null);
});
// Files dropped outside every card, header and viewer: ask what to do with them.
shell.addEventListener('dragover', (e) => { if (canEdit() && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
shell.addEventListener('drop', (e) => {
  if (!canEdit() || !e.dataTransfer?.files?.length || e.defaultPrevented) return;
  e.preventDefault();
  addFiles([...e.dataTransfer.files], null);
});

// ---- the photo report ------------------------------------------------------------------------------------------------
// A record's photos on pages, with its title and details, as a PDF: added to the record or downloaded. The marked photos
// work the same, without a record's details. The pictures are redrawn smaller as JPEGs first, so a report of forty phone photos
// is a few MB, not a few hundred.
let reporting = false;
async function photoReport(files, rec) {
  if (reporting) return;
  const pictures = files.filter((f) => REPORT_PICTURE.test(f.ext));
  const others = files.filter((f) => !REPORT_PICTURE.test(f.ext));
  if (!pictures.length) { toast(t('There are no photos to put in a report.')); return; }
  const fields = rec ? rec.fields.filter((f) => f.text).map((f) => ({ label: f.label, text: f.text })) : [];
  const otherList = others.map((f) => ({ name: f.name, info: `${typeLabel(f.ext)} · ${sizeText(f.size, uiLang())}` }));
  const oneRecord = rec || (new Set(files.map((f) => f.rowId)).size === 1 ? recordOf(files[0].rowId) : null);
  const choice = await reportBox(shell, {
    title: oneRecord?.title || t('Photo report'), recordName: rec ? (rec.title || t('this record')) : null,
    photos: pictures.map((f) => ({ name: f.name, w: f.w, h: f.h })), fields, others: otherList,
    canSave: canEdit() && !!fileColumn(), culture: gristCulture(),
  });
  if (!choice) return;

  reporting = true;
  const ctrl = new AbortController();
  const stop = { label: t('Stop'), run: () => ctrl.abort() };
  try {
    toast(t('Preparing the photos…'), stop, 0);
    const [{ loadPdfLib }, { prepareImages }, { buildReport }] = await Promise.all([import('./media/pdfsession.js'), import('./media/reportimages.js'), import('./media/report.js')]);
    const lib = await loadPdfLib();
    const { images } = await prepareImages(pictures, {
      source, maxSide: choice.perPage <= 2 ? 2000 : 1500, signal: ctrl.signal,
      onProgress: (done, total) => toast(t('Preparing photo {done} of {total}…', { done, total }), stop, 0),
    });
    const use = pictures.map((f, i) => ({ f, img: images[i] })).filter((x) => x.img);
    if (!use.length) throw new Error(t('None of the photos could be read.'));
    toast(t('Making the PDF…'), null, 0);
    const now = new Date();
    const day = new Intl.DateTimeFormat(dateLocale(gristCulture()), { dateStyle: 'medium' }).format(now);
    const spec = {
      page: choice.page, perPage: choice.perPage, title: choice.title, footerTitle: choice.title,
      subtitle: `${day} · ${tn(use.length, '{n} photo', '{n} photos')}`,
      captions: choice.captions, fields: choice.fields ? fields : [],
      photos: use.map((x) => ({ name: baseOf(x.f.name), w: x.img.w, h: x.img.h })),
      others: choice.others ? otherList : [], othersTitle: t('Other files'),
      footer: (page, count) => t('Page {n} of {count}', { n: page, count }),
    };
    const { bytes, dropped } = await buildReport(lib, spec, use.map((x) => x.img), { title: choice.title, author: 'ANUPRESS File Studio' });
    const stamp = now.toISOString().slice(0, 10);
    const name = `${t('Photo report')} ${safeName(choice.title)} ${stamp}.pdf`;
    const file = new File([bytes], name, { type: 'application/pdf' });
    const note = [
      use.length < pictures.length ? tn(pictures.length - use.length, '{n} photo could not be read and is left out.', '{n} photos could not be read and are left out.') : '',
      dropped.length ? t('Letters the PDF’s standard fonts do not have are drawn as “?”: {chars}', { chars: dropped.slice(0, 12).join(' ') }) : '',
    ].filter(Boolean).join(' ');
    if (choice.action === 'download') {
      saveBlob(file, name);
      toast(t('The report is made: {size}.', { size: sizeText(file.size, uiLang()) }) + (note ? ' ' + note : ''), null, 9000);
    } else {
      toastBox.hidden = true;
      await addFiles([file], rec?.rowId ?? (oneRecord?.rowId ?? null));
      if (note) toast(note, null, 9000);
    }
  } catch (e) {
    if (e?.name === 'AbortError') toast(t('Stopped. Nothing was made.'));
    else toast(t('The report could not be made: {why}', { why: errText(e) }));
  } finally { reporting = false; }
}

// ---- when a photo was taken --------------------------------------------------------------------------------------------------
// JPEGs say when (and with what, and perhaps where) they were taken. "Date taken" in the sort reads that from the start of each photo,
// four at a time, once, and keeps it in this browser under the photo's content hash (media/exifindex.js); a photo's details show it too.
const exifIndex = new ExifIndex();
let datesRun = null;
const S_dates = { reading: false, done: 0, total: 0 };
const byDate = (sort) => sort === 'taken-asc' || sort === 'taken-desc';
const takenOf = (f) => { const info = exifIndex.get(identOf(f)); return info ? info.taken : null; };
const datesList = () => { const seen = new Map(); for (const f of S.gallery?.files || []) if (hasExif(f) && !seen.has(identOf(f))) seen.set(identOf(f), f); return seen; };
function datesInfo() {
  if (!byDate(V().sort)) return null;
  const all = datesList();
  let unread = 0;
  for (const id of all.keys()) if (!exifIndex.has(id)) unread++;
  return { reading: S_dates.reading, done: S_dates.done, total: S_dates.total, unread, photos: all.size };
}
async function readDatesFor() {
  await exifIndex.load([...datesList().keys()]);
  updateBars();
  if (V().layout === 'files') render();
  startDates();
}
async function startDates() {
  if (S_dates.reading) return;
  const list = [...datesList()].filter(([id]) => !exifIndex.has(id)).map(([ident, file]) => ({ ident, file }));
  if (!list.length) { updateBars(); return; }
  const ctrl = new AbortController();
  datesRun = ctrl;
  Object.assign(S_dates, { reading: true, done: 0, total: list.length });
  updateBars();
  let drawn = 0;
  try {
    await exifIndex.read(list, { source, signal: ctrl.signal, onProgress: (done) => { S_dates.done = done; if (Date.now() - drawn > 700) { drawn = Date.now(); render(); } } });
  } catch (e) { toast(t('Reading the dates stopped: {why}', { why: errText(e) })); }
  finally { S_dates.reading = false; datesRun = null; }
  render();
}
/** What a photo says about itself, read now if it has not been: {taken, make, model, lat, lon, ...} or null. */
async function exifOf(f) {
  if (!hasExif(f)) return null;
  const id = identOf(f);
  if (!exifIndex.has(id)) await exifIndex.load([id]);
  if (exifIndex.has(id)) return exifIndex.get(id);
  try { return await exifIndex.readOne(id, f, source); } catch { return null; }
}

// ---- tags and notes -------------------------------------------------------------------------------------------------------
// A tag or a note belongs to a file's content (its hash) and lives in a table of the document, File_Studio_notes, which is made the first
// time someone tags a file (after asking). The table is read at the start and whenever the widget is looked at again; every change is one
// Grist action, so Undo takes it back. In the demo the table is a list in memory.
const NOTES = { exists: false, map: new Map() };
const demoNotes = { exists: false, rows: [], next: 1 };

async function loadNotes() {
  try {
    if (S.demo) { NOTES.exists = demoNotes.exists; NOTES.map = parseNotes(demoNotes.rows); }
    else {
      const rows = await fetchRows(NOTES_TABLE);
      NOTES.exists = rowsAreNotes(rows);
      NOTES.map = parseNotes(rows);
    }
  } catch { NOTES.exists = false; NOTES.map = new Map(); }   // no such table: no tags yet
  annotateNotes();
}
/** Put each file's tags and note on the file (the search, the filter, the tooltip and the details read them there). */
function annotateNotes() {
  for (const f of S.gallery?.files || []) {
    const n = NOTES.map.get(identOf(f));
    f.tags = n ? n.tags : [];
    f.note = n ? n.note : '';
    f.notesText = notesText(n);
  }
}
const notesOf = (f) => NOTES.map.get(identOf(f)) || { tags: [], note: '' };

/** The table must be there before a tag is written. Asks once; resolves true when it is (or has just been made). */
async function ensureNotesTable() {
  if (NOTES.exists) return true;
  if (!canEdit()) { toast(readOnlyWhy() || t('This document has no table for tags and notes, and you cannot add one.')); return false; }
  const ok = await confirmBox(shell, {
    title: t('Set up tags and notes?'),
    body: t('File Studio adds a table called “{table}” to this document: one row for each file you tag, with the file’s content hash, its name, the tags and the note. It is an ordinary Grist table, so you can see and edit it there. Undo takes it away again.', { table: NOTES_TABLE }),
    ok: t('Add the table'),
  });
  if (!ok) return false;
  const done = await write(createTable(), null);
  if (!done) return false;
  if (S.demo) demoNotes.exists = true;
  await loadNotes();
  return NOTES.exists;
}

/** Write changes to the notes table, then read it again. */
async function writeNotes(actions, message) {
  if (!actions.length) return true;
  const ok = await write(actions, message);
  if (ok) { await loadNotes(); render(); }
  return ok;
}

async function editNotes(f) {
  const can = canEdit();
  if (can && !(await ensureNotesTable())) return;
  const cur = notesOf(f);
  const v = await openNoteBox(shell, { name: f.name, tags: cur.tags, note: cur.note, suggestions: allTags(NOTES.map), canEdit: can });
  if (!v || !can) return;
  await writeNotes(setNote(NOTES.map, { ident: identOf(f), name: f.name }, v), t('Saved the tags and note of “{name}”.', { name: f.name }));
}

async function tagMarked() {
  const files = markedFiles();
  if (!files.length) return;
  if (!(await ensureNotesTable())) return;
  const tag = await textBox(shell, {
    title: tn(files.length, 'Tag {n} file', 'Tag {n} files'), body: allTags(NOTES.map).length ? t('In use: {tags}', { tags: allTags(NOTES.map).slice(0, 12).join(', ') }) : '',
    label: t('Tag'), ok: t('Add the tag'), empty: t('Type a tag.'),
  });
  if (!tag) return;
  const one = new Map();
  for (const f of files) if (!one.has(identOf(f))) one.set(identOf(f), { ident: identOf(f), name: f.name });
  const { actions, changed } = addTagTo(NOTES.map, [...one.values()], tag);
  if (!actions.length) { toast(t('These files have the tag “{tag}” already.', { tag: cleanTag(tag) })); return; }
  await writeNotes(actions, tn(changed, 'Tagged {n} file “{tag}”.', 'Tagged {n} files “{tag}”.').replace('{tag}', cleanTag(tag)));
}

// ---- folders and the right-click menus ----------------------------------------------------------------------------------
// Grist has no folders: a file sits in an Attachments cell, and a cell belongs to a record (a row). A folder here is a record: "New folder"
// adds a row with a name in the title column, and a file is "in" the folder when it is in that row's cell. The Files layout hides records
// without a file (a table can have thousands), so the folders made in this visit (S.fresh) stay on show, and Display can show them all.
const titleColumn = () => S.columns.find((c) => c.id === S.roles.title) || null;
const canFolder = () => canEdit() && canName(titleColumn());
const folderWhy = () => (!canEdit() ? readOnlyWhy() : !canName(titleColumn()) ? t('A folder is named in a plain Text column: choose one as the record’s name in Columns.') : null);

/** Menu items with the absent ones (false) dropped and no separator doubled, first or last. */
function tidy(items) {
  const out = [];
  for (const it of items) {
    if (it === false || it === undefined) continue;
    if (it === null && (!out.length || out[out.length - 1] === null)) continue;
    out.push(it);
  }
  if (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

async function newFolder() {
  const why = folderWhy();
  if (why) { toast(why); return; }
  const col = titleColumn();
  const name = await textBox(shell, {
    title: t('New folder'),
    body: t('A folder is a record of this table: a new row with this name in “{col}”, ready for files.', { col: col.label }),
    label: t('Name'), ok: t('Create'), empty: t('Type a name.'),
  });
  if (!name) return;
  const before = new Set(S.rows.map((r) => r.id));
  const ok = await write(newFolderActions(S.tableId, name, { titleCol: col, prefill: linkPrefill() }), t('Made the folder “{name}”.', { name }));
  if (!ok) return;
  // Grist sends the new row a moment later: wait for it, then show it and take the cursor there.
  for (let i = 0; i < 40 && newestId(S.rows, before) == null; i++) await new Promise((r) => setTimeout(r, 100));
  const id = newestId(S.rows, before);
  if (id == null) return;
  S.fresh.add(id);
  S.current = id;
  if (!S.demo) { S.selfCursor = id; moveCursor(id).catch(() => {}); }
  rebuild(); render();
  wall?.scrollToRecord(id);
}

async function renameFolder(rowId) {
  const rec = recordOf(rowId);
  const why = folderWhy();
  if (why) { toast(why); return; }
  if (!rec) return;
  const name = await textBox(shell, { title: t('Rename folder'), label: t('Name'), value: rec.title || '', ok: t('Rename'), empty: t('Type a name.') });
  if (!name) return;
  const actions = renameFolderActions(S.tableId, rowId, name, { titleCol: titleColumn(), current: rec.title || '' });
  if (!actions.length) return;
  await write(actions, t('Renamed the folder “{name}”.', { name }));
}

/** The menu of the marked files (right click on one of them while several are marked): what the marked bar offers. */
function markedMenu(anchor) {
  const files = markedFiles();
  if (!files.length) return;
  const edit = canEdit();
  const can = edit && !!fileColumn();
  const pictures = files.some((f) => REPORT_PICTURE.test(f.ext));
  const pair = files.length === 2 && files.every((f) => f.kind === 'image');
  openMenu(shell, anchor, tidy([
    [tn(files.length, '{n} file marked', '{n} files marked'), () => {}, { disabled: true }],
    null,
    [t('Download as zip'), () => zipFiles(files, t('Marked files'))],
    [t('Cut'), () => setClip(files, 'cut'), { disabled: !can || !files.some(canEditFile) }],
    [t('Copy'), () => setClip(files, 'copy'), { disabled: !can }],
    [t('Copy to…'), () => sendTo(files, 'copy'), { disabled: !can }],
    [t('Move to…'), () => sendTo(files, 'move'), { disabled: !can || !files.some(canEditFile) }],
    [t('Tag…'), () => tagMarked(), { disabled: !edit }],
    [t('Rename…'), () => renameMany(files), { disabled: !edit }],
    files.length >= 2 && files.some(mergeable) && [t('Merge into PDF…'), () => mergeFiles(files), { disabled: !edit }],
    pictures && [t('Photo report…'), () => photoReport(files, null)],
    pair && [t('Compare'), () => compareFiles(files[0], files[1])],
    null,
    [t('Unmark all'), () => clearMarks()],
    [t('Remove from records'), () => removeMany(files), { danger: true, disabled: !edit }],
  ]));
}

/** Properties of a folder: the files in it, the space they take, by type, and the record's own fields. */
function folderProps(rowId) {
  const rec = recordOf(rowId);
  if (!rec) return;
  const st = folderStats(rec.files);
  const when = (ms) => { try { return new Intl.DateTimeFormat(dateLocale(gristCulture()), { dateStyle: 'medium' }).format(new Date(ms)); } catch { return new Date(ms).toISOString().slice(0, 10); } };
  const GROUP = { image: 'Pictures', pdf: 'PDFs', video: 'Videos', audio: 'Audio', other: 'Other' };
  const size = (n) => sizeText(n, uiLang());
  const rows = [
    [t('Files'), String(st.count)],
    [t('Size'), size(st.bytes)],
    st.stored < st.bytes && [t('Stored in the document'), size(st.stored)],
    st.largest && st.count > 1 && [t('Largest'), `${st.largest.name} · ${size(st.largest.size)}`],
    st.first != null && [t('First added'), when(st.first)],
    st.last != null && st.last !== st.first && [t('Last added'), when(st.last)],
  ].filter(Boolean);
  openProps(shell, {
    name: rec.title || t('Untitled record'),
    rows,
    note: st.stored < st.bytes ? t('The same file in two cells is stored once.') : '',
    parts: st.groups.map((g) => ({ label: t(GROUP[g.group] || 'Other'), value: `${g.count} · ${size(g.bytes)}`, share: st.bytes ? g.bytes / st.bytes : 0 })),
    fields: rec.fields.filter((f) => f.text).map((f) => [f.label, f.text]),
  });
}

/** Right click on a folder: its header, its empty line or its card. */
function recordMenu(rowId, anchor) {
  const rec = recordOf(rowId);
  if (!rec) return;
  const can = canEdit() && !!fileColumn();
  const folder = canFolder();
  openMenu(shell, anchor, tidy([
    [t('Open in the Viewer'), () => { select(rowId); setView({ layout: 'viewer' }); render(); }],
    [t('Add files…'), () => pickFiles(rowId), { disabled: !can }],
    clipN() > 0 && [tn(clipN(), 'Paste {n} file here', 'Paste {n} files here'), () => pasteClip(rowId), { disabled: !can }],
    null,
    [t('New folder…'), () => newFolder(), { disabled: !folder, note: folder ? null : folderWhy() }],
    [t('Rename folder…'), () => renameFolder(rowId), { disabled: !folder }],
    null,
    [t('Download as zip'), () => zipRecord(rowId), { disabled: !rec.files.length }],
    [t('Photo report…'), () => photoReport(rec.files, rec), { disabled: !rec.files.some((f) => REPORT_PICTURE.test(f.ext)) }],
    [t('Select this record'), () => select(rowId)],
    null,
    [t('Properties…'), () => folderProps(rowId), { hint: t('How many files, how much space, what kinds') }],
  ]));
}

/** Right click on the empty part of the wall. */
function spaceMenu(anchor) {
  if (S.problem || !S.roles.files.length) return;
  const files = V().layout === 'files';
  const folder = canFolder();
  openMenu(shell, anchor, tidy([
    [t('Add files…'), () => pickFiles(null), { disabled: !(canEdit() && fileColumn()), hint: t('Into the selected record, or one new record for each file') }],
    clipN() > 0 && recordOf(S.current) && [tn(clipN(), 'Paste {n} file into “{record}”', 'Paste {n} files into “{record}”').replace('{record}', recordOf(S.current).title || t('the selected record')), () => pasteClip(S.current)],
    [t('New folder…'), () => newFolder(), { disabled: !folder, note: folder ? null : folderWhy() }],
    null,
    files && shownFiles().length > 0 && [t('Mark all shown'), () => { for (const f of shownFiles()) S.marked.add(f.key); renderState(); }],
    [t('Find a file, a folder or a command'), () => openFinder(), { hint: 'Ctrl+K' }],
    files && [V().empty ? t('Hide records without files') : t('Show records without files'), () => { setView({ empty: !V().empty }); render(); },
      { hint: t('Records that have no file yet, so files can be put in them') }],
    null,
    [t('Storage…'), () => openStorage(), { hint: t('Where the space goes, shrinking photos, freeing what nobody uses') }],
  ]));
}

// ---- cut, copy and paste between folders ---------------------------------------------------------------------------------
// Ctrl+X and Ctrl+C take the marked files (or the one with the focus) onto an inside clipboard (the computer's own clipboard is left
// alone); Ctrl+V, or "Paste" in a folder's menu, puts them into the selected record: a cut moves them, a copy puts the same files there too.
// Cut files are dimmed until they are pasted. A picture on the computer's clipboard still pastes as a new file, as before.
const clipN = () => clipFiles(S.clip, S.gallery?.files || []).length;
const focusedFiles = () => {
  if (S.marked.size) return markedFiles();
  const f = wall?.focusedFile?.();
  return f ? [f] : [];
};
function setClip(files, mode) {
  if (!files.length) return;
  if (!canEdit()) { toast(readOnlyWhy()); return; }
  if (mode === 'cut' && !files.some(canEditFile)) { toast(t('These files come from formula columns and cannot be moved here.')); return; }
  S.clip = { mode, keys: files.map((f) => f.key) };
  renderState();
  toast(mode === 'cut'
    ? tn(files.length, 'Cut {n} file. Choose a folder and press Ctrl+V.', 'Cut {n} files. Choose a folder and press Ctrl+V.')
    : tn(files.length, 'Copied {n} file. Choose a folder and press Ctrl+V.', 'Copied {n} files. Choose a folder and press Ctrl+V.'));
}
function dropClip() { if (!S.clip) return; S.clip = null; renderState(); }
async function pasteClip(rowId) {
  if (!S.clip) return false;
  const files = clipFiles(S.clip, S.gallery?.files || []);
  if (!files.length) { dropClip(); toast(t('The files that were cut or copied are no longer there.')); return false; }
  if (rowId == null || !recordOf(rowId)) { toast(t('Choose a folder to paste into.')); return false; }
  const cut = S.clip.mode === 'cut';
  const ok = await sendTo(files, cut ? 'move' : 'copy', rowId);
  if (ok && cut) dropClip();
  return ok;
}

// ---- the command palette (Ctrl+K) --------------------------------------------------------------------------------------
// One box to find a command, a folder or a file. The items are made when it opens, from what is on screen now (layout, selection, marks).
function goToFolder(rowId) {
  const rec = recordOf(rowId);
  if (!rec) return;
  // The Files layout hides records without a file: show this one for now.
  if (V().layout === 'files' && !rec.files.length && !S.fresh.has(rowId)) { S.fresh.add(rowId); render(); }
  select(rowId, { scroll: true });
}
function paletteItems() {
  const v = V();
  const inFiles = v.layout === 'files';
  const edit = canEdit();
  const can = edit && !!fileColumn();
  const out = [];
  const cmd = (label, run, o = {}) => out.push({ group: 'commands', label, run, ...o });
  if (edit) cmd(t('Add files…'), () => pickFiles(null), { disabled: !can });
  if (edit) cmd(t('New folder…'), () => newFolder(), { disabled: !canFolder(), hint: canFolder() ? '' : folderWhy() });
  if (S.marked.size) cmd(t('Unmark all'), () => clearMarks(), { keys: 'Esc' });
  if (inFiles && shownFiles().length) cmd(t('Mark all shown'), () => { for (const f of shownFiles()) S.marked.add(f.key); renderState(); });
  for (const [id, name, keys] of [['cards', 'Cards', 'Alt+1'], ['files', 'Files', 'Alt+2'], ['viewer', 'Viewer', 'Alt+3']]) {
    if (v.layout !== id) cmd(t('Layout: {name}', { name: t(name) }), () => { setView({ layout: id }); clearMarks(false); render(); }, { keys });
  }
  if (inFiles) {
    for (const [id, name] of [['justify', 'Natural'], ['square', 'Square'], ['list', 'List']]) {
      if (v.fit !== id) cmd(t('Show as: {name}', { name: t(name) }), () => { setView({ fit: id }); render(); });
    }
    for (const [id, label] of Object.entries(SORT_LABELS)) {
      if (v.sort !== id) cmd(t('Sort: {name}', { name: t(label) }), () => { setView({ sort: id }); if (byDate(id)) readDatesFor(); render(); });
    }
    for (const [id, label] of Object.entries(GROUP_LABELS)) {
      if (v.group !== id) cmd(t('Show only: {name}', { name: t(label) }), () => { setView({ group: id }); render(); });
    }
    for (const tag of allTags(NOTES.map)) {
      if (v.tag.toLowerCase() !== tag.toLowerCase()) cmd(t('Tag: {name}', { name: tag }), () => { setView({ tag }, { remember: false }); render(); });
    }
    if (v.tag) cmd(t('Tag: {name}', { name: t('Any tag') }), () => { setView({ tag: '' }, { remember: false }); render(); });
    cmd(v.empty ? t('Hide records without files') : t('Show records without files'), () => { setView({ empty: !v.empty }); render(); });
    const shown = shownFiles();
    if (shown.length) cmd(tn(shown.length, 'The {n} file shown, as zip', 'All {n} files shown, as zip'), () => zipFiles(shown, S.tableId || DEMO_TABLE));
  }
  cmd(S.inside.on ? t('Stop searching inside files') : t('Search the text inside files'), () => toggleInside());
  if (clipN() > 0 && recordOf(S.current)) cmd(tn(clipN(), 'Paste {n} file into “{record}”', 'Paste {n} files into “{record}”').replace('{record}', recordOf(S.current).title || t('the selected record')), () => pasteClip(S.current), { keys: 'Ctrl+V' });
  cmd(t('Undo'), () => undo(), { keys: 'Ctrl+Z' });
  cmd(t('Redo'), () => redo(), { keys: 'Ctrl+Y' });
  cmd(t('Storage…'), () => openStorage());
  cmd(t('Columns'), () => openColumnsPanel());
  cmd(t('Keyboard shortcuts'), () => openKeys(shell), { keys: '?' });
  for (const rec of S.gallery?.records || []) {
    out.push({ group: 'folders', label: rec.title || t('Untitled record'), hint: tn(rec.files.length, '{n} file', '{n} files'), words: rec.fields.map((f) => f.text).join(' '), run: () => goToFolder(rec.rowId) });
  }
  for (const f of S.gallery?.files || []) {
    out.push({ group: 'files', label: f.name, hint: [f.recordTitle, sizeText(f.size, uiLang())].filter(Boolean).join(' · '), words: f.notesText || '', run: () => openFile(f, null, v.layout === 'files' ? 'wall' : f.rowId) });
  }
  return out;
}
const openFinder = () => { if (S.ready && !S.problem) openPalette(shell, { items: paletteItems }); };

// ---- inside files ---------------------------------------------------------------------------------------------------
// The search can look at the words in PDFs, Word, Excel, PowerPoint and text files. Reading them means downloading each
// file once, so it starts only when asked (the switch in the filter bar, with a one-time question), can be stopped, and
// keeps its result in this browser (media/textindex.js), under the file's content hash.
const INSIDE_KEY = 'file-studio-inside', INSIDE_OK_KEY = 'file-studio-inside-ok';
const mem = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window: asked again next time */ } },
};
S.inside.on = mem.get(INSIDE_KEY) === '1';
const fileText = new TextIndex();
let insideRun = null;

function identOf(f) { return f.ident || 'att' + f.attId; }
/** The lookup the search uses for a file's own text, or null while the switch is off. */
const insideFn = () => (S.inside.on ? (f) => fileText.get(identOf(f)) || null : null);
function insideInfo() {
  let read = 0, failed = 0, unread = 0;
  for (const id of S.readable.keys()) { const st = fileText.state(id); if (st === 'ready') read++; else if (st === 'failed') failed++; else unread++; }
  return { available: S.readable.size, on: S.inside.on, reading: S.inside.reading, done: S.inside.done, total: S.inside.total, read, failed, unread };
}
/** Where the query's words are in the shown files, kept on the files for the tiles and the lightbox. */
function setHits(files, query, inside) {
  for (const f of S.gallery?.files || []) if (f.hit) f.hit = null;
  const m = inside && query ? matcher(query) : null;
  if (!m) return;
  for (const f of files) { const e = inside(f); if (e) f.hit = hitFor(e, m.words); }
}
/** The wall or the bar changes after the text changed: redraw the matches only when a search is on screen. */
function textChanged() { if (V().query && V().layout !== 'viewer') render(); else updateBars(); }

async function loadKnownText() {
  const n = await fileText.load([...S.readable.keys()]);
  if (n) textChanged();
}

async function toggleInside() {
  if (S.inside.on) {
    insideRun?.abort();
    S.inside.on = false;
    mem.set(INSIDE_KEY, '0');
    render();
    return;
  }
  await fileText.load([...S.readable.keys()]);
  const todo = [...S.readable].filter(([id]) => fileText.state(id) === 'none');
  if (todo.length && mem.get(INSIDE_OK_KEY) !== '1') {
    const bytes = todo.reduce((n, [, f]) => n + f.size, 0);
    const ok = await confirmBox(shell, {
      title: tn(todo.length, 'Read the text of {n} file?', 'Read the text of {n} files?'),
      body: t('File Studio downloads each PDF, Word, Excel and text file once ({size} in all), reads the words in it and keeps them in this browser, not in the document. After that the search can look inside the files.', { size: sizeText(bytes, uiLang()) }),
      ok: t('Read the files'),
    });
    if (!ok) return;
    mem.set(INSIDE_OK_KEY, '1');
  }
  S.inside.on = true;
  mem.set(INSIDE_KEY, '1');
  render();
  startReading();
}

async function startReading() {
  if (S.inside.reading) return;
  const list = [...S.readable].filter(([id]) => fileText.state(id) === 'none').map(([ident, file]) => ({ ident, file }));
  if (!list.length) { updateBars(); return; }
  const ctrl = new AbortController();
  insideRun = ctrl;
  Object.assign(S.inside, { reading: true, done: 0, total: list.length });
  updateBars();
  let drawn = 0;
  try {
    const res = await fileText.read(list, {
      source, signal: ctrl.signal,
      onProgress: (done) => { S.inside.done = done; if (Date.now() - drawn > 500) { drawn = Date.now(); textChanged(); } },
    });
    if (!res.stopped && res.failed) toast(tn(res.failed, '{n} file could not be read and is left out of the search.', '{n} files could not be read and are left out of the search.'));
    else if (!res.stopped && res.read) toast(tn(res.read, 'Read the text of {n} file. The search now looks inside it.', 'Read the text of {n} files. The search now looks inside them.'));
  } catch (e) {
    toast(t('Reading the files stopped: {why}', { why: errText(e) }));
  } finally {
    S.inside.reading = false;
    insideRun = null;
  }
  textChanged();
}

// ---- starting up ----------------------------------------------------------------------------------------------------
let rowsTimer = 0;
async function onRows(rows) {
  S.rows = rows;
  if (!S.ready) return;
  clearTimeout(rowsTimer);
  rowsTimer = setTimeout(async () => {
    // A column added, removed or renamed in Grist while the widget is open: the rows show it first.
    if (S.live && S.rows.length) {
      const have = new Set(S.columns.map((c) => c.id));
      const keys = Object.keys(S.rows[0]).filter((k) => k !== 'id' && k !== 'manualSort' && !k.startsWith('gristHelper_'));
      if (keys.length !== have.size || keys.some((k) => !have.has(k))) {
        forgetMeta();
        try {
          // The table itself may have been renamed.
          S.tableId = (await selectedTableId()) || S.tableId;
          S.columns = await loadColumns(S.tableId);
          S.roles = resolveRoles(S.settings.roles, S.columns);
          S.labels = await loadLabels(S.columns, [S.roles.title, ...S.roles.fields].filter(Boolean)).catch(() => S.labels);
        } catch { /* keep what is known */ }
      }
    }
    // A file uploaded through Grist's own cell (or by someone else) is not in the metadata read before.
    const known = S.meta;
    const unknown = S.roles.files.some((col) => S.rows.some((r) => attachmentIds(r[col]).some((id) => !known.has(id))));
    if (unknown) { try { S.meta = await loadFileMeta(); } catch { /* shown as missing */ } }
    rebuild(); render();
  }, 30);
}
function onCursor(rowId) {
  if (rowId == null) return;
  // Grist sends the cursor right after ready(), before the columns are read: keep it for the first draw.
  if (!S.ready) { S.current = rowId; return; }
  const mine = rowId === S.selfCursor;
  S.selfCursor = null;
  if (rowId === S.current) return;
  S.current = rowId;
  if (V().layout === 'viewer') render();
  else { renderState(); if (!mine) wall?.scrollToRecord(rowId); }
}
async function onOptions(options) {
  const json = JSON.stringify(options || null);
  if (json === S.options) return;
  S.options = json;
  S.settings = readOptions(options);
  if (!S.ready || !S.columns.length) return;
  S.roles = resolveRoles(S.settings.roles, S.columns);
  S.labels = await loadLabels(S.columns, [S.roles.title, ...S.roles.fields].filter(Boolean)).catch(() => S.labels);
  rebuild(); render();
}

async function boot() {
  updateBars('bare');
  const params = new URLSearchParams(location.search);
  const live = await start({ onRows, onOptions, onCursor });
  if (live) {
    S.live = true;
    source = liveSource;
    makeThumbs();
    S.tableId = await selectedTableId();
    if (accessLevel() !== 'full') {
      S.ready = true;
      S.problem = { title: t('File Studio needs full document access'), body: t('It reads the files and their names through Grist’s document access. In the widget panel on the right, set Access level to “Full document access”.') };
      render();
      return;
    }
    if (!S.tableId) {
      S.ready = true;
      S.problem = { title: t('Pick a table'), body: t('Choose the table with the files under “Select data” in the widget panel on the right.') };
      render();
      return;
    }
    const [columns, meta] = await Promise.all([loadColumns(S.tableId), loadFileMeta().catch(() => new Map())]);
    S.columns = columns;
    S.meta = meta;
    S.roles = resolveRoles(S.settings.roles, S.columns);
    S.labels = await loadLabels(S.columns, [S.roles.title, ...S.roles.fields].filter(Boolean)).catch(() => ({}));
    S.ownSection = await loadOwnSection(S.tableId, S.options ? JSON.parse(S.options) : null);
    // Files renamed or uploaded elsewhere: Grist sends nothing for those, so look again when the person comes back.
    window.addEventListener('focus', () => { dropTokens(); reloadMeta(); loadNotes().then(() => render()); });
  } else {
    S.demo = true;
    S.tableId = DEMO_TABLE;
    S.columns = DEMO_COLUMNS;
    const speed = params.get('example') === 'speed' ? speedData() : null;
    const rows = speed ? speed.meta : demoMeta();
    S.meta = metaFromRows(rows);
    for (const r of rows) S.meta.get(r.id).src = r.src;
    source = demoSource(S.meta, openPdf);
    makeThumbs();
    S.rows = speed ? speed.rows : demoRows();
    S.roles = resolveRoles(null, S.columns);
    S.roles.fields = [...DEMO_FIELDS];
    S.current = 1;
    const ex = params.get('layout');
    if (ex && ['cards', 'files', 'viewer'].includes(ex)) S.view.layout = ex;
  }
  const stored = readView(S.tableId);
  for (const k of ['layout', 'cardSize', 'fileSize', 'fit', 'grouped', 'captions', 'cover', 'sort', 'group', 'empty']) if (stored[k] != null && S.view[k] == null) S.view[k] = stored[k];
  // Right click on the blank part of the stage (also when the wall is not there): the wall's menu.
  stage.addEventListener('contextmenu', (e) => { if (e.defaultPrevented || e.target.closest?.('input, textarea, .gs-menu')) return; e.preventDefault(); spaceMenu({ x: e.clientX, y: e.clientY }); });
  if (!['all', 'image', 'pdf', 'video', 'audio', 'other'].includes(S.view.group)) S.view.group = 'all';
  if (!S.view.sort) S.view.sort = 'cell';
  await loadNotes();
  S.ready = true;
  rebuild();
  render();
  if (byDate(V().sort)) readDatesFor();   // a date sort kept from the last visit: its dates are loaded, the missing ones read
  // For the speed checks (tools/m1/speed.js): when the first gallery was on screen.
  try { performance.mark('file-studio:first-draw'); } catch { /* old browser */ }
}

boot().catch((e) => {
  console.error('[File Studio]', e);
  S.ready = true;
  S.problem = { title: t('Something went wrong'), body: errText(e) };
  render();
});
