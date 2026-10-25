// What a File Studio widget remembers, and where.
//
// In the widget's options (saved in the document, shared by everyone who opens the page, written only
// when someone presses Save in the Columns panel): the column roles, the layout it opens in, how
// cards and tiles look, the zip naming and the upload option.
//
// In this browser (localStorage, per table): the layout last switched to, the tile size, the filter
// chip and the sort; and the interface language. Looking around never writes to the document.

export const SETTINGS_VERSION = 1;
export const LAYOUTS = ['cards', 'files', 'viewer'];
export const FITS = ['justify', 'square'];
export const COVERS = ['fill', 'fit'];

export const DEFAULTS = Object.freeze({
  layout: 'cards',
  cards: Object.freeze({ cover: 'fill', size: 240 }),
  files: Object.freeze({ grouped: true, fit: 'justify', size: 180, captions: false }),
  zip: Object.freeze({ pattern: '{file}', folders: true, folderPattern: '{record}', manifest: true }),
  upload: Object.freeze({ shrink: false, maxSide: 2560 }),
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** Widget options as Grist returns them (or null) -> settings with every field present and valid. */
export function readOptions(options) {
  const o = isObj(options) ? options : {};
  const c = isObj(o.cards) ? o.cards : {};
  const f = isObj(o.files) ? o.files : {};
  const z = isObj(o.zip) ? o.zip : {};
  const u = isObj(o.upload) ? o.upload : {};
  return {
    roles: isObj(o.roles) ? o.roles : null,
    layout: LAYOUTS.includes(o.layout) ? o.layout : DEFAULTS.layout,
    cards: {
      cover: COVERS.includes(c.cover) ? c.cover : DEFAULTS.cards.cover,
      size: int(c.size, 140, 480) ?? DEFAULTS.cards.size,
    },
    files: {
      grouped: typeof f.grouped === 'boolean' ? f.grouped : DEFAULTS.files.grouped,
      fit: FITS.includes(f.fit) ? f.fit : DEFAULTS.files.fit,
      size: int(f.size, 80, 480) ?? DEFAULTS.files.size,
      captions: typeof f.captions === 'boolean' ? f.captions : DEFAULTS.files.captions,
    },
    zip: {
      pattern: str(z.pattern) || DEFAULTS.zip.pattern,
      folders: typeof z.folders === 'boolean' ? z.folders : DEFAULTS.zip.folders,
      folderPattern: str(z.folderPattern) || DEFAULTS.zip.folderPattern,
      manifest: typeof z.manifest === 'boolean' ? z.manifest : DEFAULTS.zip.manifest,
    },
    upload: {
      shrink: typeof u.shrink === 'boolean' ? u.shrink : DEFAULTS.upload.shrink,
      maxSide: int(u.maxSide, 640, 8000) ?? DEFAULTS.upload.maxSide,
    },
  };
}

/** Settings -> the options object saved with grist.setOptions. */
export function writeOptions(s, storedRoles) {
  return {
    v: SETTINGS_VERSION,
    roles: storedRoles,
    layout: s.layout,
    cards: { ...s.cards },
    files: { ...s.files },
    zip: { ...s.zip },
    upload: { ...s.upload },
  };
}

// ---- this browser ----
const KEY = 'galleryStudio.view.';
/** Per-table view state in this browser: {layout, cardSize, fileSize, group, sort}. */
export function readView(tableId) {
  try { const v = JSON.parse(localStorage.getItem(KEY + (tableId || 'demo')) || '{}'); return isObj(v) ? v : {}; } catch { return {}; }
}
export function writeView(tableId, patch) {
  try { localStorage.setItem(KEY + (tableId || 'demo'), JSON.stringify({ ...readView(tableId), ...patch })); } catch { /* private window */ }
}
