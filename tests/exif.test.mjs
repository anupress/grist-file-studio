// Reading when and where a photo was taken from its EXIF block (built by hand here, in both byte orders).

import { parseExif, parseHeicExif, parseAnyExif, cameraName, mapLink, placeText } from '../src/media/exif.js';
import { ExifIndex, hasExif, HEAD_BYTES } from '../src/media/exifindex.js';
import { readHead } from '../src/media/head.js';
import { sortFiles } from '../src/model/files.js';
import { tinyJpeg, withExif, tinyHeic } from './support/exif-builder.mjs';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const near = (n, got, want, eps = 1e-6) => { const ok = got != null && Math.abs(got - want) <= eps; if (ok) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${got}\n    want ${want}`); } };

const jpeg = tinyJpeg;

for (const be of [false, true]) {
  const p = parseExif(jpeg({ be }));
  const tag = be ? 'big-endian' : 'little-endian';
  eq(`${tag}: when it was taken, as the camera's wall clock`, p.taken, Date.UTC(2026, 9, 2, 14, 31, 7));
  eq(`${tag}: camera and the way it was held`, [p.make, p.model, p.orientation], ['Apple', 'iPhone 15', 6]);
  near(`${tag}: latitude`, p.lat, 48 + 12 / 60 + 30.5 / 3600);
  near(`${tag}: longitude`, p.lon, 16 + 22 / 60 + 19.5 / 3600);
  near(`${tag}: altitude`, p.altitude, 18.2);
}
const south = parseExif(jpeg({ latRef: 'S', lonRef: 'W' }));
eq('south and west are negative', [south.lat < 0, south.lon < 0], [true, true]);
const nogps = parseExif(jpeg({ gps: false }));
eq('no GPS block: a time and a camera, no place', [nogps.taken != null, nogps.lat, nogps.lon], [true, null, null]);
const zero = parseExif(jpeg({ lat: [0, 0, 0], lon: [0, 0, 0] }));
eq('a phone that does not know where it is writes 0, 0: that is no place', [zero.lat, zero.lon], [null, null]);
eq('the digitised time is used when there is no original', parseExif(jpeg({ below: true })).taken, Date.UTC(2026, 9, 2, 14, 31, 7));
eq('a camera clock that was never set is no date', parseExif(jpeg({ stamp: '0000:00:00 00:00:00' })).taken, null);
eq('not a JPEG, too short, no EXIF', [parseExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), parseExif(new Uint8Array(3)), parseExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0]))], [null, null, null]);
const cut = jpeg();
eq('a file cut off in the middle does not throw', (() => { try { parseExif(cut.subarray(0, 60)); return 'ok'; } catch (e) { return String(e); } })(), 'ok');
eq('camera names say the make once', [cameraName('Apple', 'iPhone 15'), cameraName('Canon', 'Canon EOS 5D'), cameraName('', 'X100'), cameraName('Sony', '')], ['Apple iPhone 15', 'Canon EOS 5D', 'X100', 'Sony']);
eq('a map link and a place text', [mapLink(48.2085, 16.3721), placeText(48.20849, -16.37208)], ['https://www.openstreetmap.org/?mlat=48.208500&mlon=16.372100#map=17/48.20850/16.37210', '48.20849° N, 16.37208° W']);

// ---- a real JPEG gets an EXIF block put in ----
const plainJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);
const stamped = withExif(plainJpeg, { stamp: '2026:10:06 13:40:00', make: 'Google', model: 'Pixel 8' });
eq('the block goes after the JFIF header and the picture is still there', [stamped[2], stamped[3], parseExif(stamped).model, stamped.length > plainJpeg.length, stamped.slice(-4).join(',')], [0xff, 0xe0, 'Pixel 8', true, '2,3,255,217']);
eq('a block already there is replaced, not doubled', parseExif(withExif(stamped, { make: 'Samsung', model: 'S23', stamp: '2025:01:02 03:04:05' })).make, 'Samsung');

// ---- reading the start of a response ----
const body = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
const res = new Response(new Blob([body]));
let stopped = 0;
const head = await readHead(res, 100, () => { stopped++; });
eq('the first 100 bytes and the request is told to stop', [head.length, head[99], stopped], [100, 99, 1]);
eq('a short file gives what there is', (await readHead(new Response(new Blob([body.slice(0, 20)])), 100)).length, 20);

// ---- the index of dates ----
const idx = new ExifIndex();
await idx.ready;
const files = {
  a: tinyJpeg({ stamp: '2026:10:02 10:31:00', gps: false }), b: tinyJpeg({ stamp: '2026:10:02 10:12:00', gps: false }), c: Uint8Array.from([1, 2, 3]),
};
const asked = [];
const source = { head: async (f, n) => { asked.push([f.name, n]); if (f.name === 'bad.jpg') throw new Error('Grist answered 500'); return files[f.name[0]] || new Uint8Array(0); } };
const list = [['a', 'a.jpg'], ['b', 'b.jpg'], ['c', 'c.jpg'], ['d', 'bad.jpg']].map(([ident, name]) => ({ ident, file: { name, ext: 'jpg' } }));
const progress = [];
const res2 = await idx.read(list, { source, onProgress: (d, t) => progress.push([d, t]) });
eq('four photos: three read (one of them without any EXIF), one that failed', [res2.read, res2.failed, res2.stopped], [3, 1, false]);
eq('each was asked for 128 kB at most', [...new Set(asked.map((x) => x[1]))], [HEAD_BYTES]);
eq('dates kept, and "no EXIF" remembered as null, and an unread one unknown', [idx.get('a').taken, idx.get('b').taken, idx.get('c'), idx.has('c'), idx.has('d')], [Date.UTC(2026, 9, 2, 10, 31), Date.UTC(2026, 9, 2, 10, 12), null, true, false]);
eq('progress counts every one', progress.length, 4);
const again = await idx.read(list, { source });
eq('a second run reads only what failed', [again.read, again.failed, asked.length], [0, 1, 5]);
eq('only JPEGs and HEIC pictures are read', ['jpg', 'jpeg', 'JPG', 'png', 'webp', 'heic', 'pdf'].map((e) => hasExif({ ext: e.toLowerCase() })), [true, true, true, false, false, true, false]);

// ---- sorting by the date taken ----
const set = [
  { name: 'n1', uploaded: 5, id: 'a' }, { name: 'n2', uploaded: 4, id: 'b' }, { name: 'n3', uploaded: 3, id: 'x' }, { name: 'n4', uploaded: 2, id: 'y' }, { name: 'n5', uploaded: 1, id: 'c' },
];
const taken = (f) => ({ a: 300, b: 100, c: 200 })[f.id] ?? null;
eq('oldest first, photos with no date last (in the order they were uploaded)', sortFiles(set, 'taken-asc', { taken }).map((f) => f.name), ['n2', 'n5', 'n1', 'n4', 'n3']);
eq('newest first, still none last', sortFiles(set, 'taken-desc', { taken }).map((f) => f.name), ['n1', 'n5', 'n2', 'n4', 'n3']);
eq('with no dates known at all it is upload order', sortFiles(set, 'taken-asc').map((f) => f.name), ['n5', 'n4', 'n3', 'n2', 'n1']);
eq('the same moment: by name', sortFiles([{ name: 'b', id: 'a' }, { name: 'a', id: 'a' }], 'taken-asc', { taken }).map((f) => f.name), ['a', 'b']);

// HEIC: the EXIF block is an item found through iinf and iloc
for (const [name, o] of [['iloc version 0', {}], ['iloc version 1', { v1: true }], ['the picture first', { exifFirst: false }]]) {
  const h = tinyHeic({}, o);
  const p = parseHeicExif(h.bytes);
  eq(`HEIC (${name}): when, camera and place`, [p && p.taken, p && p.model, p && Math.round(p.lat * 1e4) / 1e4], [Date.UTC(2026, 9, 2, 14, 31, 7), 'iPhone 15', 48.2085]);
}
const far = tinyHeic({}, { exifFirst: false, pictureBytes: 5000 });
eq('HEIC: the block lies beyond what was read: no date', parseHeicExif(far.bytes.subarray(0, far.exifAt + 20)), null);
eq('HEIC: read in full, the same file has its date', parseHeicExif(far.bytes).taken, Date.UTC(2026, 9, 2, 14, 31, 7));
eq('HEIC: a big-endian block', parseHeicExif(tinyHeic({ be: true }).bytes).taken, Date.UTC(2026, 9, 2, 14, 31, 7));
eq('HEIC: not a HEIC, too short, damaged', [parseHeicExif(new Uint8Array(30)), parseHeicExif(jpeg({})), parseHeicExif(tinyHeic().bytes.subarray(0, 40)), parseHeicExif(Uint8Array.from([0, 0, 0, 12, 102, 116, 121, 112, 104, 101, 105, 99, 255, 255, 255, 255]))], [null, null, null, null]);
eq('either kind: the JPEG and the HEIC are read, anything else is not', [parseAnyExif(jpeg({})).model, parseAnyExif(tinyHeic().bytes).model, parseAnyExif(new Uint8Array(40)), parseAnyExif(new Uint8Array(3))], ['iPhone 15', 'iPhone 15', null, null]);
eq('a HEIC has a date to read', [hasExif({ ext: 'heic' }), hasExif({ ext: 'heif' }), hasExif({ ext: 'png' })], [true, true, false]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
