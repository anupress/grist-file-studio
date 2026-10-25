// Scans: a PDF page with no text is noted, and read by the text recognition when it is allowed; pictures are read only then.
// The recognition itself (media/ocr.js: a worker, a canvas) is not run here: a fake reader stands in for it.

import { extractDetailed, extractPages, readableKind, canRead, TextIndex } from '../src/media/textindex.js';
import { tidyText, ocrLanguages } from '../src/media/ocr.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

// a PDF of three pages: text, a scan, a scan
const doc = (texts) => ({
  numPages: texts.length, destroy() { this.gone = true; },
  async getPage(n) { return { async getTextContent() { return { items: texts[n - 1] ? [{ str: texts[n - 1], hasEOL: false }] : [] }; }, cleanup() {} }; },
});
const reader = (said) => ({ calls: [], async page(d, n) { this.calls.push('page' + n); return said[n] ?? ''; }, async image() { this.calls.push('image'); return said.image ?? ''; } });
const openPdf = (d) => async () => d;

const d1 = doc(['A page that has real text in it, long enough.', '', '']);
const plain = await extractDetailed(new Blob(['x']), 'pdf', { openPdf: openPdf(d1) });
eq('without recognition the scans are noted, not read', [plain.pages, plain.scanned, plain.recognised], [['A page that has real text in it, long enough.', '', ''], [2, 3], 0]);

const r1 = reader({ 2: 'Meter readings 4821 kWh', 3: '' });
const seen = [];
const withOcr = await extractDetailed(new Blob(['x']), 'pdf', { openPdf: openPdf(doc(['A page that has real text in it, long enough.', '', ''])), ocr: r1, onPage: (n, total) => seen.push([n, total]) });
eq('with recognition the scanned pages are read (the one with nothing stays empty)', [withOcr.pages, withOcr.scanned, withOcr.recognised], [['A page that has real text in it, long enough.', 'Meter readings 4821 kWh', ''], [2, 3], 1]);
eq('only the scans go to the reader, and it says which page', [r1.calls, seen], [['page2', 'page3'], [[2, 3], [3, 3]]]);
eq('a page with text of its own is never sent to the reader', doc(['x'.repeat(20)]).numPages && (await extractDetailed(new Blob(['x']), 'pdf', { openPdf: openPdf(doc(['x'.repeat(20)])), ocr: reader({}) })).scanned, []);
const gone = doc(['', '']);
await extractDetailed(new Blob(['x']), 'pdf', { openPdf: openPdf(gone) });
eq('the PDF is closed after reading', gone.gone, true);

const pic = reader({ image: 'Fire exit' });
eq('a picture is read by recognition', await extractDetailed(new Blob(['x']), 'jpg', { ocr: pic }), { pages: ['Fire exit'], scanned: [1], recognised: 1 });
eq('a picture with no words has an empty page and nothing recognised', (await extractDetailed(new Blob(['x']), 'png', { ocr: reader({}) })).recognised, 0);
let none = null; try { await extractPages(new Blob(['x']), 'jpg'); } catch (e) { none = e.message; }
eq('a picture cannot be read without recognition', none, 'No text to read in this kind of file.');

eq('what can be read: pictures (HEIC too) only when asked', [readableKind('jpg', 'image'), readableKind('jpg', 'image', { pictures: true }), readableKind('mp4', 'video', { pictures: true }), readableKind('heic', 'heic', { pictures: true })], [null, 'image', null, 'image']);
eq('size limits for pictures', [canRead({ ext: 'jpg', kind: 'image', size: 5e6 }, { pictures: true }), canRead({ ext: 'jpg', kind: 'image', size: 40e6 }, { pictures: true }), canRead({ ext: 'jpg', kind: 'image', size: 1 })], [true, false, false]);

// the index: scans left, and a file read again once recognition is allowed
const idx = new TextIndex();
const source = (d, said) => ({ blob: async () => new Blob(['x']), openPdf: openPdf(d) });
const f1 = { ident: 'h1', file: { ext: 'pdf' } };
const res1 = await idx.read([f1], { source: source(doc(['A page that has real text in it, long enough.', '', ''])) });
eq('first read: the scans are counted', [res1.read, idx.scansLeft('h1'), idx.get('h1').scanned], [1, 2, [2, 3]]);
const res2 = await idx.read([f1], { source: source(doc(['x'])) });
eq('read again without recognition: nothing to do', res2.read, 0);
const ocr = reader({ 2: 'Strom 4821 kWh', 3: 'Wasser 117 Kubikmeter' });
const res3 = await idx.read([f1], { source: source(doc(['A page that has real text in it, long enough.', '', ''])), ocr });
eq('with recognition the scanned file is read again, and its scans are done', [res3.read, res3.recognised, idx.scansLeft('h1'), idx.get('h1').pages[1], idx.get('h1').ocrRan], [1, 2, 0, 'Strom 4821 kWh', true]);
eq('the words are searchable once recognised', idx.get('h1').all.includes('kubikmeter'), true);
const res4 = await idx.read([f1], { source: source(doc(['x'])), ocr });
eq('and not read a third time', res4.read, 0);
const res5 = await idx.read([{ ident: 'p1', file: { ext: 'jpg' } }], { source: source(doc(['x'])), ocr: reader({ image: 'Exit' }) });
eq('a picture is read once', [res5.read, idx.get('p1').pages, idx.state('p1')], [1, ['Exit'], 'ready']);

eq('tidy: spaces, lines', tidyText('  Handover   protocol \n\n\n\n Meter  readings\t4821 \n'), 'Handover protocol\n\nMeter readings 4821');
eq('languages: the interface language and English', [ocrLanguages('de'), ocrLanguages('fr'), ocrLanguages('en'), ocrLanguages('xx')], [['deu', 'eng'], ['fra', 'eng'], ['eng'], ['eng']]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
