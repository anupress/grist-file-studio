// The widget's whole conversation with Grist.
//
// Not the Advanced Charts bridge, on purpose. Grist reads only the FIRST
// grist.ready() of a widget, so everything File Studio needs has to be in that one call: full access
// (file metadata, file contents, writes) and allowSelectBy (so a card or table can follow the
// record picked here). The bridge's connect() cannot pass the second.
//
// What was measured in real Grist (1.7.20), and what this file does about it:
//   - onRecords sends only the columns SHOWN in the widget's own section unless asked otherwise,
//     and a column added to the table later is never shown there. So the table is requested
//     with includeColumns 'normal' (every real column, no helper columns).
//   - keepEncoded keeps cells exactly as Grist stores them: ['d', secs] for a Date,
//     ['D', secs, zone] for a DateTime, ['R', table, id] for a Reference, ['L', ...] for lists. That
//     is the shape writes go back in, so dates never pass through a JS Date on the way.
//   - The rows arrive after the section's own filters, sort and Select-by. Nothing to redo here.
//   - Every change to the widget's table delivers the WHOLE table again (about 300 ms after a one-cell
//     edit on 4,000 rows). Diffing is the caller's job.
//   - A change to any OTHER table sends nothing at all, nor does a change to _grist_Attachments (a rename,
//     M0), so the caller re-reads those itself.
//
// Outside Grist (a plain tab, ?demo, or a frame on some other site) every call is a harmless no-op
// and start() resolves false, so the app shows its demo instead.

const g = () => (typeof window !== 'undefined' ? window.grist : undefined);
const apiPresent = () => { try { return !!g() && typeof g().ready === 'function'; } catch { return false; } };

// expandRefs: false keeps a Reference as ['R', table, id]. Left on (Grist's default), a Reference whose
// column shows another column (every Reference in Grist's templates) arrives as that column's TEXT,
// "Leonardo" instead of People 2, and every id-based feature quietly stops (found in M4).
export const ROW_OPTIONS = Object.freeze({ includeColumns: 'normal', keepEncoded: true, expandRefs: false });

let live = false;
let access = 'none';
let linking = { asTarget: null, asSource: false };
let culture = null;

export const isLive = () => live;
export const accessLevel = () => access;
export const linkingInfo = () => linking;
/** Grist's culture for this document (e.g. 'de-DE'), from the widget URL; null outside Grist. */
export const gristCulture = () => culture;

function withTimeout(promise, ms) {
  let timer;
  const clock = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

/**
 * Register the handlers, send the single ready(), and wait for Grist to answer.
 *
 * Handlers go in BEFORE ready(): Grist sends the first rows as soon as it hears ready, and a
 * handler registered later only sees the next change. A reply from the host, not ready() itself,
 * proves a Grist is there: ready() returns at once inside any iframe on any page.
 *
 * @param {{onRows?: Function, onOptions?: Function}} handlers
 * @returns {Promise<boolean>} true when connected to a real Grist
 */
export async function start({ onRows, onOptions, onCursor } = {}, timeoutMs = 4000) {
  if (live) return true;
  if (!apiPresent()) return false;
  try { const p = new URLSearchParams(location.search); if (p.has('demo')) return false; culture = p.get('culture'); } catch { /* no location */ }
  try { if (window.self === window.top) return false; } catch { /* cross-origin parent: framed */ }
  const api = g();
  // Two answers matter: any message proves a Grist is there; the one carrying settings says which
  // access it granted. They are separate messages (the first is often only the theme), and a widget
  // that went on before the second drew itself read-only (found in M2).
  let accessKnown;
  const accessReported = new Promise((resolve) => { accessKnown = resolve; });
  const answered = new Promise((resolve) => {
    api.on('message', (msg) => {
      const level = msg?.settings?.accessLevel;
      if (typeof level === 'string' && level) { access = level; accessKnown(); }
      resolve(true);
    });
  });
  api.onOptions((options, interaction) => {
    if (interaction?.accessLevel) { access = interaction.accessLevel; accessKnown(); }
    if (interaction?.linking) linking = interaction.linking;
    onOptions?.(options || null, interaction || null);
  });
  if (onRows) api.onRecords((rows) => onRows(rows), ROW_OPTIONS);
  // The widget's own cursor: moves when a linked widget selects a row, or after moveCursor().
  // Only the id is used, so only the shown fields are asked for.
  if (onCursor) api.onRecord((rec) => onCursor(rec && rec.id != null ? rec.id : null), { keepEncoded: true });
  api.ready({ requiredAccess: 'full', allowSelectBy: true });
  try { await withTimeout(answered, timeoutMs); } catch { return false; }
  await withTimeout(accessReported, 2000).catch(() => { /* an older Grist: go on with what is known */ });
  live = true;
  return true;
}

// ---- reading -----------------------------------------------------------------------------------

/** Grist's columnar table as rows. Works for metadata tables too (_grist_Tables_column, ...). */
export async function fetchRows(tableId) {
  if (!live) return [];
  const t = await g().docApi.fetchTable(tableId);
  const ids = t.id || [];
  const keys = Object.keys(t);
  return ids.map((_, i) => { const r = {}; for (const k of keys) r[k] = t[k][i]; return r; });
}

export async function selectedTableId() {
  if (!live) return null;
  try { return await g().getSelectedTableId(); } catch { return null; }
}

// ---- writing -------------------------------------------------------------------------------------

/** One action bundle = one undo step. Throws Grist's own error (access rules, bad value) to the caller. */
export function apply(actions) {
  if (!live || !actions.length) return Promise.resolve(null);
  return g().docApi.applyUserActions(actions);
}

export async function getOptions() { return live ? (await g().getOptions()) || null : null; }
export function setOptions(options) { return live ? g().setOptions(options) : Promise.resolve(); }

// ---- the page around the widget ------------------------------------------------------------------

/** Move this widget's cursor: a card or table linked to it follows. 'new' shows a blank new record. */
export function moveCursor(rowId) { return live ? g().setCursorPos({ rowId }) : Promise.resolve(); }

/** Narrow a linked table to these rows (null clears). */
export function selectRows(rowIds) { return live ? g().setSelectedRows(rowIds) : Promise.resolve(); }

/**
 * Open Grist's own record card for the row under this widget's cursor (move the cursor first).
 * Works only while this widget's section is the active one and shows at least one field: with no
 * visible field Grist fails with "Cannot read properties of null (reading 'column')".
 */
export function openRecordCard() { return live ? g().commandApi.run('viewAsCard') : Promise.resolve(); }

/** Grist's undo, so a mistaken removal can be taken back without leaving the widget. */
export function undo() { return live ? g().commandApi.run('undo') : Promise.resolve(); }

/** Grist's redo, the counterpart of undo(). */
export function redo() { return live ? g().commandApi.run('redo') : Promise.resolve(); }
