// Searching inside files: reading zip-based Office files, the words in them, folding, hits and the search model.

import zlib from 'node:zlib';
import { readZip } from '../src/media/unzip.js';
import { makeZip } from '../src/media/zip.js';
import { docxText, pptxText, odfText, xlsxText, htmlText } from '../src/media/officetext.js';
import { prepare, hitFor, shorten, fold } from '../src/model/textsearch.js';
import { matcher, visibleFiles, visibleRecords } from '../src/model/files.js';
import { extractPages, readableKind, canRead, TextIndex } from '../src/media/textindex.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

// ---- zip: a deflate zip made by hand (what Word writes) and one made by our own writer (stored) ----
function deflateZip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = Buffer.from(name, 'utf8'), raw = Buffer.from(text, 'utf8'), data = zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length / 2, 8); eocd.writeUInt16LE(central.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Blob([Buffer.concat([...parts, cd, eocd])]);
}
const zipD = await readZip(deflateZip({ 'word/document.xml': '<w:p><w:r><w:t>Übergabe Müller</w:t></w:r></w:p>', 'a/ü.txt': 'x'.repeat(5000) }));
eq('a deflate zip lists its entries', zipD.names, ['word/document.xml', 'a/ü.txt']);
eq('and inflates one', await zipD.text('word/document.xml'), '<w:p><w:r><w:t>Übergabe Müller</w:t></w:r></w:p>');
eq('a long entry can be cut short', (await zipD.text('a/ü.txt', 100)).length, 100);
let err = null; try { await zipD.text('nope.xml'); } catch (e) { err = e.message; }
eq('a missing entry says so', err, 'No nope.xml in the zip file.');
const zipS = await readZip(await makeZip([{ path: 'xl/sharedStrings.xml', blob: new Blob(['<sst><si><t>Rechnung</t></si></sst>']) }]));
eq('the zip our own writer makes (stored) reads back', await zipS.text('xl/sharedStrings.xml'), '<sst><si><t>Rechnung</t></si></sst>');
let notZip = null; try { await readZip(new Blob(['plain text'])); } catch (e) { notZip = e.message; }
eq('not a zip file', notZip, 'Not a zip file.');

// ---- the words in Office files ----
eq('Word: paragraphs, tabs, entities', docxText('<w:p><w:r><w:t>Rechnung R-2026-014</w:t></w:r></w:p><w:p><w:r><w:t>Müller &amp; Söhne</w:t></w:r><w:tab/><w:r><w:t>14 Tage</w:t></w:r></w:p>'), 'Rechnung R-2026-014\nMüller & Söhne 14 Tage');
eq('Word: numeric entities', docxText('<w:p><w:t>a&#233;b&#x20AC;</w:t></w:p>'), 'aéb€');
eq('PowerPoint: the runs of a slide', pptxText('<a:p><a:r><a:t>Quarterly</a:t></a:r></a:p><a:p><a:r><a:t>results</a:t></a:r></a:p>'), 'Quarterly\nresults');
eq('OpenDocument', odfText('<text:h>Vertrag</text:h><text:p>Zahlungsziel<text:tab/>14 Tage</text:p>'), 'Vertrag\nZahlungsziel 14 Tage');
const sst = '<sst><si><t>Room</t></si><si><r><t>Mei</t></r><r><t>er</t></r></si></sst>';
const sheet = '<row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>48213.7</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>inline</t></is></c><c r="E1"/></row>';
eq('Excel: shared strings, their runs, and numbers; a string index is not a number', xlsxText(sst, [sheet]), 'Room\nMeier\n48213.7 inline');
eq('HTML: visible words only', htmlText('<html><head><title>x</title><style>p{}</style></head><body><h1>Titel</h1><script>var a = "secret";</script><p>Erste &amp; zweite</p></body></html>'), 'Titel\nErste & zweite');

// ---- folding and hits ----
eq('folding drops accents and case', fold('Müller ÉCOLE Straße'), 'muller ecole straße');
const doc = prepare(['Invoice for Müller GmbH. Payment within 14 days.', 'Terms and conditions apply to every order.', 'Signed in Vienna. Müller agrees to the terms.']);
eq('an entry keeps each page and the whole', [doc.pages.length, doc.all.split('\f').length], [3, 3]);
eq('one word: the pages that hold it, the first one is quoted', hitFor(doc, ['muller']), { words: 1, pages: [1, 3], paged: true, snippet: 'Invoice for Müller GmbH. Payment within 14 days.', parts: ['Invoice for ', 'Müller', ' GmbH. Payment within 14 days.'] });
const two = hitFor(doc, ['muller', 'terms']);
eq('two words: the page with both comes first', [two.pages, two.words], [[3], 2]);
eq('a word that is not there is no hit', hitFor(doc, ['zebra']), null);
eq('one of two words is still a hit (the other may be in the record)', hitFor(doc, ['zebra', 'order']).pages, [2]);
const long = prepare(['x '.repeat(100) + 'needle' + ' y'.repeat(100)]);
eq('a snippet is cut around the word with dots', hitFor(long, ['needle']).snippet.startsWith('…') && hitFor(long, ['needle']).snippet.endsWith('…') && hitFor(long, ['needle']).snippet.includes('needle'), true);
const h = hitFor(long, ['needle']);
eq('the snippet in three parts: before, the word, after', [h.parts[1], h.parts[0].startsWith('…'), h.parts[2].endsWith('…'), h.parts.join('') === h.snippet], ['needle', true, true, true]);
eq('a short version for a small tile keeps the word and trims both sides', shorten(h, 10), ['…x x x x x ', 'needle', ' y y y y y…']);
eq('and leaves a short snippet whole', shorten(hitFor(doc, ['muller']), 40), ['Invoice for ', 'Müller', ' GmbH. Payment within 14 days.']);
eq('a single page is not "paged"', hitFor(prepare(['hello world']), ['hello']).paged, false);

// ---- matching with the file text ----
const gallery = { records: [
  { rowId: 1, title: 'Müller GmbH', fields: [{ text: 'Vienna' }], files: [{ key: 'a', name: 'scan-001.pdf', group: 'pdf', ident: 'A' }, { key: 'b', name: 'photo.jpg', group: 'image', ident: 'B' }] },
  { rowId: 2, title: 'Schmidt AG', fields: [{ text: 'Berlin' }], files: [{ key: 'c', name: 'contract.pdf', group: 'pdf', ident: 'C' }] },
] };
const texts = { A: prepare(['Rechnung R-2026-014 Zahlungsziel 14 Tage']), C: prepare(['Vertrag über Lieferung']) };
const inside = (f) => texts[f.ident] || null;
const m = matcher('rechnung muller');
eq('the matcher knows its words', m.words, ['rechnung', 'muller']);
eq('without the file text the name and record do not hold "rechnung"', visibleFiles(gallery, { query: 'rechnung muller' }).files.length, 0);
eq('with it: "muller" from the record, "rechnung" from the scan', visibleFiles(gallery, { query: 'rechnung muller', inside }).files.map((f) => f.key), ['a']);
eq('a word only in the other record\'s file does not leak across records', visibleFiles(gallery, { query: 'vertrag', inside }).files.map((f) => f.key), ['c']);
eq('the cards: a record whose file text matches', visibleRecords(gallery, { query: 'zahlungsziel', inside }).map((r) => r.rowId), [1]);
eq('the cards without the text: nothing', visibleRecords(gallery, { query: 'zahlungsziel' }).length, 0);
eq('accents do not matter in the file text', visibleFiles(gallery, { query: 'ueber', inside }).files.length, 0);
eq('(but ü is not ue: "uber" finds "über")', visibleFiles(gallery, { query: 'uber', inside }).files.map((f) => f.key), ['c']);
eq('an empty query shows everything', visibleFiles(gallery, { query: '', inside }).files.length, 3);

// ---- reading the text of whole files ----
const zipOf = (files) => makeZip(Object.entries(files).map(([path, text]) => ({ path, blob: new Blob([text]) })));
eq('Word file: the paragraphs', await extractPages(await zipOf({ 'word/document.xml': '<w:p><w:t>Kaufvertrag</w:t></w:p><w:p><w:t>Wien</w:t></w:p>' }), 'docx'), ['Kaufvertrag\nWien']);
eq('Excel file: strings and numbers of every sheet', await extractPages(await zipOf({
  'xl/sharedStrings.xml': '<sst><si><t>Miete</t></si></sst>', 'xl/worksheets/sheet1.xml': '<row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>950</v></c></row>', 'xl/worksheets/sheet2.xml': '<row><c r="A1"><v>77</v></c></row>' }), 'xlsx'), ['Miete\n950\n77']);
eq('PowerPoint file: one page per slide, in slide order', await extractPages(await zipOf({
  'ppt/slides/slide10.xml': '<a:p><a:t>Zehn</a:t></a:p>', 'ppt/slides/slide2.xml': '<a:p><a:t>Zwei</a:t></a:p>', 'ppt/slides/slide1.xml': '<a:p><a:t>Eins</a:t></a:p>' }), 'pptx'), ['Eins', 'Zwei', 'Zehn']);
eq('OpenDocument file', await extractPages(await zipOf({ 'content.xml': '<text:p>Mietvertrag</text:p>' }), 'odt'), ['Mietvertrag']);
eq('HTML file: visible words only', await extractPages(new Blob(['<head><title>t</title></head><p>Hallo &amp; Welt</p><script>x=1</script>']), 'html'), ['Hallo & Welt']);
eq('plain text', await extractPages(new Blob(['eine Zeile\nzwei']), 'txt'), ['eine Zeile\nzwei']);
let noText = null; try { await extractPages(new Blob(['x']), 'jpg'); } catch (e) { noText = e.message; }
eq('a picture has no text to read', noText, 'No text to read in this kind of file.');
eq('what can be read', [readableKind('pdf'), readableKind('docx'), readableKind('txt', 'text'), readableKind('jpg', 'image'), readableKind('mp4', 'video')], ['pdf', 'office', 'text', null, null]);
eq('size limits: a 90 MB PDF is too big, a 5 MB one is not', [canRead({ ext: 'pdf', kind: 'pdf', size: 90e6 }), canRead({ ext: 'pdf', kind: 'pdf', size: 5e6 })], [false, true]);

// the index: reads two at a time, remembers, can be stopped, marks what cannot be read
const idx = new TextIndex();
await idx.ready;
const fake = { blob: async (f) => new Blob([f.body]), openPdf: null };
const items = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ ident: n, file: { ext: 'txt', body: n === 'c' ? null : 'wort ' + n } }));
items[2].file = { ext: 'jpg', body: 'x' };   // cannot be read
const seen = [];
const res = await idx.read(items, { source: fake, onProgress: (d, t) => seen.push([d, t]) });
eq('five files: four read, one could not', [res.read, res.failed, res.stopped], [4, 1, false]);
eq('progress counts in twos, ends on the total', seen, [[2, 5], [4, 5], [5, 5]]);
eq('states', ['a', 'c', 'zzz'].map((i) => idx.state(i)), ['ready', 'failed', 'none']);
eq('what was read can be searched', hitFor(idx.get('b'), ['wort']).pages, [1]);
const again = await idx.read(items, { source: fake });
eq('a second run reads nothing again', [again.read, again.failed], [0, 0]);
const stopper = new AbortController();
const idx2 = new TextIndex();
await idx2.ready;
const stopped = await idx2.read(items.map((x) => ({ ...x, ident: x.ident + '2' })), { source: fake, signal: stopper.signal, onProgress: (d) => { if (d >= 2) stopper.abort(); } });
eq('stopping after the first pair leaves the rest unread', [stopped.stopped, idx2.state('a2'), idx2.state('e2')], [true, 'ready', 'none']);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
