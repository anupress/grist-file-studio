// The PDF tools' operations: page plans, merging, splitting, turning pages, and where marks land.
// Runs the same pdf-lib bundle the widget ships (vendor/pdflib/pdflib.mjs).

import * as lib from '../vendor/pdflib/pdflib.mjs';
import {
  norm, turnPoint, turnElement, displaySize, userPoint, localPoint, elementBox, parseRanges, splitGroups, numberLabel, stampElements,
  unsupportedChars, smoothPathD, drawElements, openDocument, imageToPdf, buildPdf, hasSignature, NUMBER_POSITIONS,
} from '../src/media/pdfops.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const near = (n, got, want, eps = 0.01) => { const ok = got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) <= eps); if (ok) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const rnd = (v) => Math.round(v * 1000) / 1000;

// ---- turning the unit square -------------------------------------------------------------------
eq('norm folds angles', [norm(-90), norm(450), norm(360), norm(0)], [270, 90, 0, 0]);
const tl = { x: 0, y: 0 }, br = { x: 1, y: 1 };
eq('top-left corner turned 90 cw goes to the top-right', turnPoint(tl, 90), { x: 1, y: 0 });
eq('top-left turned 180 goes to the bottom-right', turnPoint(tl, 180), { x: 1, y: 1 });
eq('top-left turned 270 goes to the bottom-left', turnPoint(tl, 270), { x: 0, y: 1 });
eq('bottom-right turned 90 goes to the bottom-left', turnPoint(br, 90), { x: 0, y: 1 });
let p = { x: 0.2, y: 0.7 };
for (let i = 0; i < 4; i++) p = turnPoint(p, 90);
eq('four quarter turns are no turn', [rnd(p.x), rnd(p.y)], [0.2, 0.7]);
const back = turnPoint(turnPoint({ x: 0.3, y: 0.1 }, 90), 270);
near('90 then 270 is no turn', [back.x, back.y], [0.3, 0.1], 1e-9);
const tx = { type: 'text', x: 0.25, y: 0.5, angle: 0, text: 'a' };
eq('a text mark turned 90 keeps its place on the paper and gains the angle', turnElement(tx, 90), { type: 'text', x: 0.5, y: 0.25, angle: 90, text: 'a' });
eq('turned back it is the same', turnElement(turnElement(tx, 90), 270).angle, 0);
eq('a pen mark turns its points', turnElement({ type: 'draw', points: [[0, 0], [1, 1]] }, 90).points, [[1, 0], [0, 1]]);

// ---- display frame to the file's user space ----------------------------------------------------
const crop = { x: 10, y: 20, width: 200, height: 100 };
eq('displayed size swaps for sideways pages', [displaySize(crop, 0), displaySize(crop, 90), displaySize(crop, 270)], [{ w: 200, h: 100 }, { w: 100, h: 200 }, { w: 100, h: 200 }]);
eq('R0: top-left of the page is the top-left of the file', userPoint(tl, 0, crop), { x: 10, y: 120 });
eq('R0: bottom-right', userPoint(br, 0, crop), { x: 210, y: 20 });
eq('R90: top-left shows the file\'s bottom-left', userPoint(tl, 90, crop), { x: 10, y: 20 });
eq('R90: top-right shows the file\'s top-left', userPoint({ x: 1, y: 0 }, 90, crop), { x: 10, y: 120 });
eq('R180: top-left shows the file\'s bottom-right', userPoint(tl, 180, crop), { x: 210, y: 20 });
eq('R270: top-left shows the file\'s top-right', userPoint(tl, 270, crop), { x: 210, y: 120 });
eq('R270: top-right shows the file\'s bottom-right', userPoint({ x: 1, y: 0 }, 270, crop), { x: 210, y: 20 });
// Turning a page and then asking where a mark is must agree with the file: the same spot of paper.
for (const R of [0, 90, 180, 270]) {
  const spot = { x: 0.3, y: 0.8 };
  const before = userPoint(spot, 0, crop);
  const after = userPoint(turnPoint(spot, R), R, crop);
  near(`a spot of paper keeps its file position when the page is turned ${R}`, [before.x, before.y], [after.x, after.y]);
}
near('a mark\'s local point: 10 pt right of a mark turned 90 is below it', (({ x, y }) => [x, y])(localPoint({ x: 0.5, y: 0.5, angle: 90 }, 10, 0, 100, 200)), [0.5, 0.55]);
const box = elementBox({ x: 0.5, y: 0.5, w: 40, h: 10, angle: 0 }, 200, 100);
near('a box mark\'s box in unit fractions', [box.x, box.y, box.w, box.h], [0.4, 0.45, 0.2, 0.1]);
const box90 = elementBox({ x: 0.5, y: 0.5, w: 40, h: 10, angle: 90 }, 200, 100);
near('turned 90 the same mark is tall', [box90.x, box90.y, box90.w, box90.h], [0.475, 0.3, 0.05, 0.4]);

// ---- ranges and splits ------------------------------------------------------------------------
eq('ranges: pages and spans', parseRanges('1-3, 5, 8-', 10), { groups: [[0, 1, 2], [4], [7, 8, 9]] });
eq('ranges: one page', parseRanges('4', 6), { groups: [[3]] });
eq('ranges: an open start', parseRanges('-3', 6), { groups: [[0, 1, 2]] });
eq('ranges: out of range', parseRanges('2-9', 6), { error: 'range' });
eq('ranges: backwards', parseRanges('5-2', 6), { error: 'range' });
eq('ranges: zero', parseRanges('0', 6), { error: 'range' });
eq('ranges: nonsense', parseRanges('a-b', 6), { error: 'syntax' });
eq('ranges: nothing', parseRanges('  ', 6), { error: 'empty' });
eq('split: each page', splitGroups('each', 3).groups, [[0], [1], [2]]);
eq('split: every 2', splitGroups('every', 5, 2).groups, [[0, 1], [2, 3], [4]]);
eq('split: every 0 is refused', splitGroups('every', 5, 0), { error: 'syntax' });
eq('split: ranges', splitGroups('ranges', 5, '1-2, 4').groups, [[0, 1], [3]]);

// ---- numbering and watermark -------------------------------------------------------------------
const nm = { word: 'Page', start: 1, skipFirst: false, format: 'n' };
eq('numbers: plain', [numberLabel(nm, 0, 4), numberLabel(nm, 3, 4)], ['1', '4']);
eq('numbers: of total', [numberLabel({ ...nm, format: 'n-of-m' }, 1, 4), numberLabel({ ...nm, format: 'page-n-of-m' }, 1, 4)], ['2 / 4', 'Page 2 / 4']);
eq('numbers: skip the cover, the second page is 1', [numberLabel({ ...nm, skipFirst: true }, 0, 4), numberLabel({ ...nm, skipFirst: true }, 1, 4), numberLabel({ ...nm, skipFirst: true, format: 'n-of-m' }, 3, 4)], [null, '1', '3 / 3']);
eq('numbers: start at 5', numberLabel({ ...nm, start: 5, format: 'n-of-m' }, 0, 3), '5 / 7');
const el = stampElements({ numbers: { on: true, position: 'br', format: 'n', size: 10 } }, 0, 2, 200, 100)[0];
eq('number at the bottom right: anchored right and bottom, 28 pt in', [el.align, el.valign, rnd(el.x), rnd(el.y)], ['right', 'bottom', 0.86, 0.72]);
eq('six positions', NUMBER_POSITIONS.length, 6);
const wm = stampElements({ watermark: { on: true, text: 'DRAFT' } }, 0, 1, 200, 100)[0];
eq('watermark: centred, rising to the right', [wm.align, wm.valign, wm.x, wm.y, wm.angle], ['center', 'middle', 0.5, 0.5, 315]);
eq('no numbers, no watermark: nothing', stampElements({}, 0, 1, 200, 100), []);

// ---- text the standard fonts can draw ---------------------------------------------------------
const scratch = await lib.PDFDocument.create();
const helv = await scratch.embedFont(lib.StandardFonts.Helvetica);
const charset = new Set(helv.getCharacterSet());
eq('German, French and the euro sign are fine', unsupportedChars(charset, 'Größe ça été € „quoted“'), []);
eq('other scripts are reported', unsupportedChars(charset, 'a 中 ā b').sort(), ['中', 'ā'].sort());
eq('a pen path through three points', smoothPathD([[0, 0], [10, 0], [20, 10]]), 'M0 0 Q10 0 15 5 L20 10');

// ---- building files ---------------------------------------------------------------------------
const makeDoc = async (n, base, extra = {}) => {
  const d = await lib.PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([base + i, 200]);
  if (extra.title) d.setTitle(extra.title);
  return d.save();
};
const A = await makeDoc(4, 100, { title: 'The first' });    // pages 100,101,102,103 wide
const B = await makeDoc(3, 300);                           // 300,301,302
const load = (srcs) => async (id) => openDocument(lib, srcs[id]);
const widths = async (bytes) => (await openDocument(lib, bytes)).getPages().map((pg) => Math.round(pg.getSize().width));
const rotations = async (bytes) => (await openDocument(lib, bytes)).getPages().map((pg) => pg.getRotation().angle);
const pg = (id, src, page, rotate = 0) => ({ id, src, page, rotate });

let r = await buildPdf(lib, { load: load({ a: A }), pages: [pg('p0', 'a', 0), pg('p1', 'a', 1), pg('p2', 'a', 2), pg('p3', 'a', 3)] });
eq('a plan that changes nothing keeps the pages', await widths(r.bytes), [100, 101, 102, 103]);
eq('and the document information', (await openDocument(lib, r.bytes)).getTitle(), 'The first');
r = await buildPdf(lib, { load: load({ a: A }), pages: [pg('p3', 'a', 3), pg('p0', 'a', 0), pg('p2', 'a', 2)] });
eq('reorder and delete: 4th, 1st, 3rd', await widths(r.bytes), [103, 100, 102]);
r = await buildPdf(lib, { load: load({ a: A }), pages: [pg('p1', 'a', 1), pg('d1', 'a', 1), pg('p0', 'a', 0)] });
eq('a duplicated page is two pages', await widths(r.bytes), [101, 101, 100]);
r = await buildPdf(lib, { load: load({ a: A }), pages: [pg('p0', 'a', 0, 90), pg('p1', 'a', 1), pg('p2', 'a', 2, 270)] });
eq('rotating adds to the page\'s rotation', await rotations(r.bytes), [90, 0, 270]);
r = await buildPdf(lib, { load: load({ a: A, b: B }), pages: [pg('a0', 'a', 0), pg('b0', 'b', 0), pg('b2', 'b', 2), pg('a1', 'a', 1), pg('b0b', 'b', 0)] });
eq('merging: pages from two files in the order given, one twice', await widths(r.bytes), [100, 300, 302, 101, 300]);
r = await buildPdf(lib, { load: load({ a: A, b: B }), pages: [pg('b0', 'b', 0), pg('b1', 'b', 1), pg('a0', 'a', 0)] });
eq('merging into a file that starts with the second source', await widths(r.bytes), [300, 301, 100]);
// a source that already carries /Rotate: turning adds to it
const rotatedSrc = await (async () => { const d = await lib.PDFDocument.create(); d.addPage([100, 50]).setRotation(lib.degrees(90)); return d.save(); })();
r = await buildPdf(lib, { load: load({ s: rotatedSrc }), pages: [pg('s0', 's', 0, 90)] });
eq('a page already at 90 turned 90 more is at 180', await rotations(r.bytes), [180]);

// a split-off page carries nothing of the others (pdf-lib never prunes, so this is built fresh)
const textDoc = await (async () => {
  const d = await lib.PDFDocument.create();
  const f = await d.embedFont(lib.StandardFonts.Helvetica);
  for (let i = 0; i < 4; i++) d.addPage([200, 200]).drawText('Private text of page ' + (i + 1), { x: 10, y: 100, size: 12, font: f });
  return d.save();
})();
const objectCount = async (b) => (await openDocument(lib, b)).context.enumerateIndirectObjects().length;
const oneOfFour = await buildPdf(lib, { load: load({ t: textDoc }), pages: [pg('t2', 't', 2)] });
const everyPage = await buildPdf(lib, { load: load({ t: textDoc }), pages: [0, 1, 2, 3].map((i) => pg('t' + i, 't', i)) });
eq('one page out of four has far fewer objects than all four, not as many as the original', [await objectCount(oneOfFour.bytes) < (await objectCount(everyPage.bytes)) - 4, (await widths(oneOfFour.bytes)).length], [true, 1]);
eq('and is smaller', oneOfFour.bytes.length < textDoc.length, true);
eq('pages left out: the fresh path still turns', await rotations((await buildPdf(lib, { load: load({ t: textDoc }), pages: [pg('t1', 't', 1, 180)] })).bytes), [180]);
const inPlaceKeepsForm = await (async () => {
  const d = await lib.PDFDocument.create(); d.addPage([100, 100]); d.addPage([120, 100]);
  d.getForm().createTextField('name').addToPage(d.getPage(0), { x: 10, y: 10, width: 50, height: 12 });
  d.setTitle('With a form');
  const src = await d.save();
  const kept = await buildPdf(lib, { load: load({ f: src }), pages: [pg('f1', 'f', 1), pg('f0', 'f', 0)] });
  const re = await openDocument(lib, kept.bytes);
  return [re.getTitle(), re.getForm().getFields().length, (await widths(kept.bytes))[0]];
})();
eq('reordering every page keeps the form field and the title', inPlaceKeepsForm, ['With a form', 1, 120]);

// marks and numbers end up in the file
const sizeOf = (b) => b.length;
const plain = await buildPdf(lib, { load: load({ a: A }), pages: [pg('p0', 'a', 0), pg('p1', 'a', 1)] });
const marked = await buildPdf(lib, {
  load: load({ a: A }), pages: [pg('p0', 'a', 0), pg('p1', 'a', 1)],
  marks: new Map([['p0', [{ type: 'text', x: 0.1, y: 0.1, text: 'Hello', size: 12, font: 'serif', bold: true, color: '#cc0000', angle: 0 },
    { type: 'rect', x: 0.5, y: 0.5, w: 30, h: 20, color: '#000000', angle: 0 }, { type: 'check', x: 0.7, y: 0.7, w: 21, h: 21, color: '#008800', angle: 0 },
    { type: 'draw', points: [[0.1, 0.2], [0.2, 0.3], [0.3, 0.2]], color: '#0000ff', width: 2 }]]]),
  stamp: { numbers: { on: true, position: 'bc', format: 'n-of-m', size: 10 }, watermark: { on: true, text: 'COPY' } },
});
eq('marked file reloads with the same pages', await widths(marked.bytes), [100, 101]);
eq('and is larger than the plain one', sizeOf(marked.bytes) > sizeOf(plain.bytes), true);
const withBad = await buildPdf(lib, { load: load({ a: A }), pages: [pg('p0', 'a', 0)], marks: new Map([['p0', [{ type: 'text', x: 0.1, y: 0.1, text: 'a 中 b', size: 12, font: 'sans', color: '#000000', angle: 0 }]]]) });
eq('characters the fonts cannot draw are reported, not thrown', withBad.dropped, ['中']);
let threw = false;
try { await buildPdf(lib, { load: load({}), pages: [] }); } catch { threw = true; }
eq('no pages is an error', threw, true);

// ---- where marks are drawn: a page that records the calls ---------------------------------------
const spyDoc = await lib.PDFDocument.create();
const spy = (angle, cropBox) => {
  const calls = [];
  return { calls, getRotation: () => ({ angle }), getCropBox: () => cropBox, drawText: (t, o) => calls.push(['text', t, o]), drawLine: (o) => calls.push(['line', o]),
    drawRectangle: (o) => calls.push(['rect', o]), drawImage: (i, o) => calls.push(['image', o]), pushOperators() {}, drawSvgPath: (d, o) => calls.push(['svg', d, o]) };
};
const book = (() => { const cache = {}; return async (family, bold, italic) => { const k = `${family}${bold}${italic}`; if (!cache[k]) { const font = await spyDoc.embedFont(lib.StandardFonts.Helvetica); cache[k] = { font, charset: new Set(font.getCharacterSet()) }; } return cache[k]; }; })();
const text = { type: 'text', x: 0.5, y: 0.5, text: 'Hi', size: 10, font: 'sans', color: '#000000', angle: 0 };
let s0 = spy(0, { x: 0, y: 0, width: 200, height: 100 });
await drawElements(lib, spyDoc, s0, [text], book, new Map());
near('text on an upright page: the baseline sits 9.7 pt under the anchor', [s0.calls[0][2].x, s0.calls[0][2].y], [100, 50 - 9.7]);
eq('and is not rotated', lib.degrees(0).angle, s0.calls[0][2].rotate.angle);
let s90 = spy(90, { x: 0, y: 0, width: 200, height: 100 });
await drawElements(lib, spyDoc, s90, [text], book, new Map());
near('on a page shown turned 90 the same mark is rotated 90 and moved to the file spot of the display point', [s90.calls[0][2].x, s90.calls[0][2].y], [(0.5 + 9.7 / 200) * 200, 50]);
eq('rotate 90', s90.calls[0][2].rotate.angle, 90);
let s270 = spy(270, { x: 0, y: 0, width: 200, height: 100 });
await drawElements(lib, spyDoc, s270, [{ ...text, angle: 90 }], book, new Map());
eq('a mark turned 90 clockwise on a page at 270 is at 180 degrees in the file', s270.calls[0][2].rotate.angle, 180);
let sc = spy(0, { x: 0, y: 0, width: 200, height: 100 });
await drawElements(lib, spyDoc, sc, [{ ...text, text: 'AB', align: 'right', x: 0.5 }], book, new Map());
const wAB = helv.widthOfTextAtSize('AB', 10);
near('right-aligned text ends at the anchor', [sc.calls[0][2].x + wAB], [100]);
sc = spy(0, { x: 0, y: 0, width: 200, height: 100 });
await drawElements(lib, spyDoc, sc, [{ type: 'rect', x: 0.5, y: 0.5, w: 40, h: 20, color: '#ffffff', angle: 0 }], book, new Map());
near('a cover box: bottom-left and size in the file', [sc.calls[0][1].x, sc.calls[0][1].y, sc.calls[0][1].width, sc.calls[0][1].height], [80, 40, 40, 20]);
sc = spy(90, { x: 0, y: 0, width: 200, height: 100 });
await drawElements(lib, spyDoc, sc, [{ type: 'rect', x: 0.5, y: 0.5, w: 40, h: 20, color: '#ffffff', angle: 0 }], book, new Map());
near('the same box on a page shown turned: wide in the display is tall in the file', [sc.calls[0][1].width, sc.calls[0][1].height], [20, 40]);
sc = spy(0, { x: 5, y: 7, width: 200, height: 100 });
await drawElements(lib, spyDoc, sc, [{ type: 'rect', x: 0.1, y: 0.2, w: 10, h: 10, color: '#000000', angle: 0 }], book, new Map());
// centre at 20 pt right and 20 pt down; the box spans x 15..25 and 15..25 down: in the file 5 + 15 = 20 left, and 7 + (100 - 25) = 82 bottom
near('a crop box that does not start at the origin shifts everything', [sc.calls[0][1].x, sc.calls[0][1].y], [20, 82]);

// ---- pictures as pages, signatures, passwords ---------------------------------------------------
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const tall = await imageToPdf(lib, PNG, 'png', 3000, 4000);
const tallPage = (await openDocument(lib, tall)).getPage(0).getSize();
near('a 3000 x 4000 photo becomes an A4-long page of the same shape', [tallPage.width, tallPage.height], [631.5, 842], 0.1);
const tiny = await imageToPdf(lib, PNG, 'png', 300, 200);
eq('a small picture keeps its size', [(await openDocument(lib, tiny)).getPage(0).getSize().width], [300]);
r = await buildPdf(lib, { load: load({ a: A, i: tall }), pages: [pg('a0', 'a', 0), pg('i0', 'i', 0)] });
eq('a photo page merges like any other', (await widths(r.bytes)).length, 2);
eq('no signature in a plain file', hasSignature(A), false);
eq('a ByteRange is a signature', hasSignature(new TextEncoder().encode('%PDF-1.7 /Contents <00> /ByteRange [0 10 20 30]')), true);
const secret = await lib.PDFDocument.create(); secret.addPage([100, 100]); secret.encrypt({ userPassword: 'open', ownerPassword: 'own', permissions: {} });
const secretBytes = await secret.save();
let err = null;
try { await openDocument(lib, secretBytes); } catch (e) { err = e; }
eq('an encrypted file without a password says so', err instanceof lib.EncryptedPDFError, true);
eq('with the password it opens and saves unprotected', await (async () => { const d = await openDocument(lib, secretBytes, 'open'); const out = await d.save(); try { await lib.PDFDocument.load(out, { updateMetadata: false }); return true; } catch { return false; } })(), true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
