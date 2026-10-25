// The demo: a small property-inspection table with photos, a report, a walkthrough video, a voice
// note and some documents, shaped exactly as Grist sends it (keepEncoded cells, _grist_Attachments
// rows), so the demo runs through the same code as a real document. Its files live in demo/.
//
// Also the demo's file source: URLs are the files next to the page, uploads become object URLs that
// live until the tab closes, and nothing leaves the browser.

import { kindOf, extOf } from '../model/kinds.js';
import { columnsFromFixture } from '../model/schema.js';
import { readHead } from '../media/head.js';

// [file, bytes, width, height]
const FILES = [
  ['living-room.jpg', 96151, 1248, 832], ['kitchen.jpg', 78854, 1248, 832], ['damp-corner.jpg', 85602, 1152, 864],
  ['bathroom.jpg', 64278, 832, 1248], ['facade.jpg', 157250, 832, 1248], ['bedroom.jpg', 56088, 1248, 832],
  ['balcony.jpg', 180277, 1280, 720], ['floor-plan.png', 26539, 1400, 1000], ['inspection-report.pdf', 110005, 0, 0],
  ['notes.txt', 386, 0, 0], ['walkthrough.mp4', 379592, 0, 0], ['meter-readings.csv', 252, 0, 0],
  ['handover-protocol.docx', 36946, 0, 0], ['smoke-alarm-test.mp3', 32617, 0, 0],
  ['handover-checklist.md', 570, 0, 0], ['listing.html', 769, 0, 0], ['move-in-form.pdf', 11099, 0, 0], ['inspection-costs.xlsx', 6302, 0, 0],
];
const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 1, 9);

export const DEMO_TABLE = 'Inspections';
/** What a demo card shows under the property. */
export const DEMO_FIELDS = ['Inspector', 'Visited'];

export const DEMO_COLUMNS = columnsFromFixture([
  { id: 'Property', type: 'Text' },
  { id: 'Inspector', type: 'Choice' },
  { id: 'Visited', type: 'Date' },
  { id: 'Photos', type: 'Attachments' },
  { id: 'Documents', type: 'Attachments' },
]);

export function demoMeta() {
  return FILES.map(([name, size, w, h], i) => ({
    id: i + 1, fileName: name, fileExt: '.' + extOf(name), fileSize: size, fileIdent: 'demo-' + name, imageWidth: w, imageHeight: h,
    timeUploaded: T0 + i * DAY * 0.7, timeDeleted: null, src: 'demo/' + name,
  }));
}

const L = (...ids) => (ids.length ? ['L', ...ids] : null);
const D = (y, m, d) => ['d', Date.UTC(y, m - 1, d) / 1000];

export function demoRows() {
  return [
    { id: 1, Property: 'Testgasse 7, Vienna', Inspector: 'Anna', Visited: D(2026, 10, 2), Photos: L(1, 2, 3, 4), Documents: L(9, 10, 15, 8, 18) },
    { id: 2, Property: 'Hafenstraße 12, Hamburg', Inspector: 'Jonas', Visited: D(2026, 10, 6), Photos: L(5, 6), Documents: L(11, 12, 13, 17) },
    { id: 3, Property: '14 Rue des Lilas, Lyon', Inspector: 'Claire', Visited: D(2026, 10, 9), Photos: L(7), Documents: L(14, 16, 13) },
    { id: 4, Property: 'Kanalstraße 41, Berlin', Inspector: 'Jonas', Visited: null, Photos: null, Documents: null },
  ];
}

/**
 * The speed example (?demo=1&example=speed): 2,000 records with five files each, 10,000 files, every
 * one its own attachment (its own cache key), drawn from the demo's pictures, PDF and video.
 */
export function speedData(records = 2000, perRecord = 5) {
  const base = demoMeta();
  const pool = base.filter((m) => /\.(jpg|png|pdf|mp4)$/.test(m.fileName));
  const meta = [];
  const rows = [];
  let id = 1;
  for (let r = 1; r <= records; r++) {
    const ids = [];
    for (let k = 0; k < perRecord; k++) {
      const m = pool[(r * 7 + k * 3) % pool.length];
      meta.push({ ...m, id, fileIdent: `${m.fileIdent}#${id}`, fileName: m.fileName.replace(/\./, `-${r}-${k + 1}.`) });
      ids.push(id++);
    }
    rows.push({ id: r, Property: `Property ${r}`, Inspector: ['Anna', 'Jonas', 'Claire'][r % 3], Visited: D(2026, 1 + (r % 12), 1 + (r % 27)), Photos: L(...ids.slice(0, 4)), Documents: L(...ids.slice(4)) });
  }
  return { meta, rows };
}

/** The demo's file source (the live one is grist/files.js). Uploads are kept as object URLs. */
export function demoSource(meta, openPdf) {
  const extra = new Map();   // id -> object URL of an uploaded file
  let next = 1000;
  const url = (file) => extra.get(file.attId) || meta.get(file.attId)?.src || 'demo/' + file.name;
  return {
    url: async (file) => url(file),
    async blob(file, { type = '', signal = null, onProgress = null } = {}) {
      const res = await fetch(url(file), { signal });
      const b = await res.blob();
      onProgress?.(b.size, b.size);
      return type && b.type !== type ? new Blob([b], { type }) : b;
    },
    async head(file, n, { signal = null } = {}) {
      const ctrl = new AbortController();
      if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
      return readHead(await fetch(url(file), { signal: ctrl.signal }), n, () => ctrl.abort());
    },
    openPdf,
    async upload(files, { onProgress = null } = {}) {
      const ids = [];
      for (const f of files) {
        const id = next++;
        const blob = f instanceof Blob ? f : f.blob;
        extra.set(id, URL.createObjectURL(blob));
        let w = 0, h = 0;
        if (kindOf(extOf(f.name)) === 'image') { try { const b = await createImageBitmap(blob); w = b.width; h = b.height; b.close?.(); } catch { /* not a picture after all */ } }
        meta.set(id, { id, name: f.name, ext: extOf(f.name), kind: kindOf(extOf(f.name)), size: blob.size, ident: 'demo-up-' + id, w, h, uploaded: Date.now(), src: extra.get(id) });
        ids.push(id);
      }
      onProgress?.(1, 1);
      return ids;
    },
  };
}
