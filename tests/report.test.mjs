// The photo report's layout: wrapping, the grid, where rows break, the lists and the footers (media/report.js draws what this decides).

import * as lib from '../vendor/pdflib/pdflib.mjs';
import { layoutReport, wrapText, ellipsize, fit, defaultPage, PAGE_SIZES, GRIDS } from '../src/model/report.js';
import { buildReport } from '../src/media/report.js';
import { REPORT_PICTURE } from '../src/media/reportimages.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const ok = (n, v) => eq(n, !!v, true);
const measure = (s, size) => s.length * size * 0.5;   // every character half an em wide

// ---- text ----
eq('wrap at spaces', wrapText('aaa bbb ccc ddd', 40, measure, 10), ['aaa bbb', 'ccc ddd']);
eq('wrap keeps newlines', wrapText('one\ntwo', 200, measure, 10), ['one', 'two']);
eq('a word wider than the line is cut', wrapText('abcdefghij', 30, measure, 10), ['abcdef', 'ghij']);
eq('too many lines: the last ends in an ellipsis', wrapText('aaa bbb ccc ddd eee fff', 40, measure, 10, { maxLines: 2 }), ['aaa bbb', 'ccc ddd…']);
eq('empty text is one empty line', wrapText('', 100, measure, 10), ['']);
eq('ellipsize leaves a short text', ellipsize('abc', 100, measure, 10), 'abc');
eq('ellipsize cuts a long one to fit', ellipsize('abcdefghij', 30, measure, 10), 'abcde…');
const e = ellipsize('abcdefghijklmnop', 41, measure, 10);
ok('and never wider than asked', measure(e, 10) <= 41);

// ---- shapes ----
eq('contain: a landscape picture in a wide box is limited by the height', Object.fromEntries(Object.entries(fit(4000, 3000, 400, 100)).map(([k, v]) => [k, Math.round(v * 100) / 100])), { w: 133.33, h: 100 });
eq('contain: in a narrow box by the width', fit(4000, 3000, 100, 400), { w: 100, h: 75 });
eq('a picture of unknown shape is 4:3', fit(0, 0, 400, 300), { w: 400, h: 300 });
eq('Letter in the US and Canada, A4 elsewhere', [defaultPage('en-US'), defaultPage('en-CA'), defaultPage('en-GB'), defaultPage('de-DE'), defaultPage('')], ['letter', 'letter', 'a4', 'a4', 'a4']);

// ---- pages ----
const photos = (n, w = 4000, h = 3000) => Array.from({ length: n }, (_, i) => ({ name: `photo-${i + 1}.jpg`, w, h }));
const base = { page: 'a4', title: 'Testgasse 7, Top 4', subtitle: '25 Oct 2026 · 12 photos', fields: [], photos: [], others: [], captions: true, footer: (p, n) => `Page ${p} of ${n}`, footerTitle: 'Testgasse 7, Top 4' };
const count = (r, k) => r.pages.map((p) => p.ops.filter((o) => o.k === k).length);
const inside = (r) => r.pages.every((p) => p.ops.every((o) => (o.k !== 'photo') || (o.x >= 0 && o.y >= 0 && o.x + o.w <= r.size.w && o.y + o.h <= r.size.h - 40)));

for (const per of [1, 2, 4, 6]) {
  const r = layoutReport({ ...base, perPage: per, photos: photos(13) }, measure);
  eq(`${per} per page: all 13 photos are placed, once each`, r.pages.flatMap((p) => p.ops.filter((o) => o.k === 'photo').map((o) => o.i)).sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => i));
  ok(`${per} per page: none leaves the page`, inside(r));
  ok(`${per} per page: no page holds more than the grid`, count(r, 'photo').every((n) => n <= per));
}
const six = layoutReport({ ...base, perPage: 6, photos: photos(12) }, measure);
eq('six per page with a title block: the third row is drawn a little smaller to fit page 1', count(six, 'photo'), [6, 6]);
const sixRows = six.pages[0].ops.filter((o) => o.k === 'photo');
ok('...and is the only smaller one', sixRows[4].h < sixRows[0].h && sixRows[0].h === sixRows[2].h);
const four = layoutReport({ ...base, perPage: 4, photos: photos(12) }, measure);
eq('four per page: a full row and most of a second one fit under the title', count(four, 'photo'), [4, 4, 4]);
const one = layoutReport({ ...base, perPage: 1, photos: photos(3, 1000, 3000) }, measure);
eq('one per page: the first photo shares page 1 with the title when more than half a page is left', count(one, 'photo'), [1, 1, 1]);
const onePhoto = one.pages[0].ops.find((o) => o.k === 'photo');
const laterPhoto = one.pages[1].ops.find((o) => o.k === 'photo');
ok('...and is drawn smaller there', onePhoto.h < laterPhoto.h);

// a long list of fields pushes the photos to the next page
const many = Array.from({ length: 24 }, (_, i) => ({ label: `Field ${i + 1}`, text: 'a value that is long enough to wrap onto a second line when the column is narrow, really'.repeat(1) }));
const heavy = layoutReport({ ...base, perPage: 4, fields: many, photos: photos(4) }, measure);
eq('many fields: the photos start on a later page and all still appear', [count(heavy, 'photo').reduce((a, b) => a + b, 0), count(heavy, 'photo')[0]], [4, 0]);
ok('fields are in two columns', new Set(heavy.pages[0].ops.filter((o) => o.k === 'text' && o.size === 11).map((o) => Math.round(o.x))).size === 2);
const blanks = layoutReport({ ...base, perPage: 4, fields: [{ label: 'A', text: '' }, { label: 'B', text: '  ' }, { label: 'C', text: 'x' }], photos: photos(1) }, measure);
eq('a field with no value is left out', blanks.pages[0].ops.filter((o) => o.k === 'text' && o.size === 8.5).map((o) => o.text), ['C']);

// captions
const cap = layoutReport({ ...base, perPage: 6, photos: [{ name: 'a-very-long-photo-name-that-cannot-fit-in-a-column-at-all-really.jpg', w: 100, h: 100 }] }, measure);
const capOp = cap.pages[0].ops.find((o) => o.k === 'text' && o.size === 9 && o.align === 'center');
ok('a long caption is cut with an ellipsis', capOp && capOp.text.endsWith('…'));
const nocap = layoutReport({ ...base, perPage: 6, captions: false, photos: photos(2) }, measure);
eq('no captions: none are drawn', nocap.pages[0].ops.filter((o) => o.k === 'text' && o.align === 'center').length, 0);
const pic = (r) => r.pages[0].ops.find((o) => o.k === 'photo');
ok('...and the photos get the room', pic(nocap).h >= pic(layoutReport({ ...base, perPage: 6, captions: true, photos: photos(2) }, measure)).h);

// the other files
const others = Array.from({ length: 90 }, (_, i) => ({ name: `document-${i + 1}.pdf`, info: 'PDF · 120 kB' }));
const list = layoutReport({ ...base, perPage: 4, photos: photos(2), others, othersTitle: 'Other files' }, measure);
eq('90 other files: every one is listed', list.pages.flatMap((p) => p.ops.filter((o) => o.k === 'text' && /^document-/.test(o.text))).length, 90);
ok('...over several pages', list.pages.length >= 3);
eq('the heading appears once', list.pages.flatMap((p) => p.ops.filter((o) => o.text === 'Other files')).length, 1);
eq('each has its info on the right', list.pages[0].ops.filter((o) => o.align === 'right' && o.text === 'PDF · 120 kB').length > 0, true);
ok('no line is drawn below the page', list.pages.every((p, k) => p.ops.filter((o) => o.k === 'text' && /^document-/.test(o.text)).every((o) => o.y + 12 < list.size.h - 50)));

// the footer and the first block
eq('every page has its footer', layoutReport({ ...base, perPage: 4, photos: photos(12) }, measure).pages.map((p) => p.ops.filter((o) => /^Page \d+ of \d+$/.test(o.text || '')).map((o) => o.text)[0]), ['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3']);
eq('the title of a long name is two lines at most', layoutReport({ ...base, title: 'word '.repeat(80), perPage: 4 }, measure).pages[0].ops.filter((o) => o.k === 'text' && o.size === 22).length, 2);
eq('an empty report still has a first page with a rule', [layoutReport({ ...base, perPage: 4 }, measure).pages.length, layoutReport({ ...base, perPage: 4 }, measure).pages[0].ops.some((o) => o.k === 'rule')], [1, true]);
const letter = layoutReport({ ...base, page: 'letter', perPage: 4, photos: photos(3) }, measure);
eq('Letter paper is used when asked', letter.size, PAGE_SIZES.letter);
eq('grids', GRIDS, { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3] });

// ---- the file itself ----
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const spec = { ...base, perPage: 4, fields: [{ label: 'Inspector', text: 'Anna Berger' }, { label: 'Visited', text: '2 October 2026' }, { label: 'Notes', text: 'Damp patch at the bedroom window, Größe 42 €, 日本語' }], photos: photos(5), others: [{ name: 'inspection-report.pdf', info: 'PDF · 110 kB' }], othersTitle: 'Other files' };
const built = await buildReport(lib, spec, spec.photos.map(() => ({ bytes: PNG, type: 'png' })), { title: 'Testgasse 7, Top 4', author: 'ANUPRESS' });
const out = await lib.PDFDocument.load(built.bytes, { updateMetadata: false });
eq('the PDF has the pages the layout made', out.getPageCount(), built.pages);
ok('...more than one for five photos four to a page with a title block', built.pages >= 2);
eq('A4 pages', [Math.round(out.getPage(0).getWidth()), Math.round(out.getPage(0).getHeight())], [595, 842]);
eq('the title and producer are set', [out.getTitle(), out.getProducer()], ['Testgasse 7, Top 4', 'ANUPRESS File Studio']);
eq('letters the standard font lacks are reported, not lost silently', built.dropped.sort(), ['日', '本', '語'].sort());
ok('the file is small (one shared picture)', built.bytes.length < 30000);
const bare = await buildReport(lib, { ...base, perPage: 6, page: 'letter' }, [], {});
eq('a report with no pictures is one Letter page', [bare.pages, Math.round((await lib.PDFDocument.load(bare.bytes, { updateMetadata: false })).getPage(0).getHeight())], [1, 792]);
let bad = null;
try { await buildReport(lib, { ...base, perPage: 4, photos: photos(1) }, [{ bytes: new Uint8Array([1, 2, 3]), type: 'jpg' }], {}); } catch (e) { bad = e.message; }
ok('a picture that is not a JPEG fails loudly', bad);
eq('what counts as a picture (HEIC is decoded in the browser)', ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'heic', 'svg', 'pdf'].filter((x) => REPORT_PICTURE.test(x)), ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'heic']);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
