// The PDF tools' second set: form fields, pages redrawn as pictures, a password, a blank page.
// Runs the same pdf-lib bundle the widget ships (vendor/pdflib/pdflib.mjs).

import zlib from 'node:zlib';
import * as lib from '../vendor/pdflib/pdflib.mjs';
import { userPoint, displayPoint, widgetBox, formFields, applyForm, blankPdf, picturePages, buildPdf, openDocument } from '../src/media/pdfops.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const ok = (n, v) => eq(n, !!v, true);
const near = (n, got, want, eps = 1e-9) => { const good = got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) <= eps); if (good) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---- user space <-> display frame ----
const crop = { x: 10, y: 20, width: 200, height: 100 };
for (const rot of [0, 90, 180, 270]) {
  const p = { x: 0.3, y: 0.7 };
  const back = displayPoint(userPoint(p, rot, crop), rot, crop);
  near(`display <- user is the inverse of user <- display at ${rot}`, [back.x, back.y], [0.3, 0.7]);
}
const b0 = widgetBox({ x: 30, y: 30, width: 40, height: 30 }, 0, crop);
near('a field box on an upright page', [b0.x, b0.y, b0.w, b0.h], [0.1, 0.6, 0.2, 0.3]);
const b90 = widgetBox({ x: 30, y: 30, width: 40, height: 30 }, 90, crop);
near('turned a quarter, the box swaps its sides', [r3(b90.w), r3(b90.h)], [0.3, 0.2]);
const b270 = widgetBox({ x: 30, y: 30, width: 40, height: 30 }, 270, crop);
near('and its middle is where the turned page puts it', [r3(b270.x + b270.w / 2), r3(b270.y + b270.h / 2)], [0.75, 0.8]);

// ---- a form made with pdf-lib ----
async function makeForm() {
  const doc = await lib.PDFDocument.create();
  const p1 = doc.addPage([300, 400]), p2 = doc.addPage([300, 400]);
  p2.setRotation(lib.degrees(90));
  const form = doc.getForm();
  form.createTextField('name').addToPage(p1, { x: 20, y: 340, width: 200, height: 24 });
  const notes = form.createTextField('notes'); notes.enableMultiline(); notes.addToPage(p1, { x: 20, y: 200, width: 260, height: 80 });
  const short = form.createTextField('code'); short.setMaxLength(4); short.addToPage(p1, { x: 20, y: 120, width: 60, height: 20 });
  form.createCheckBox('agree').addToPage(p1, { x: 20, y: 160, width: 16, height: 16 });
  const dd = form.createDropdown('city'); dd.addOptions(['Wien', 'Graz']); dd.addToPage(p2, { x: 30, y: 300, width: 120, height: 22 });
  const rg = form.createRadioGroup('size'); rg.addOptionToPage('S', p2, { x: 30, y: 200, width: 14, height: 14 }); rg.addOptionToPage('L', p2, { x: 80, y: 200, width: 14, height: 14 });
  const ol = form.createOptionList('tags'); ol.addOptions(['a', 'b', 'c']); ol.addToPage(p2, { x: 30, y: 100, width: 80, height: 60 });
  const ro = form.createTextField('locked'); ro.setText('fixed'); ro.enableReadOnly(); ro.addToPage(p1, { x: 20, y: 60, width: 80, height: 20 });
  form.createButton('go').addToPage('Go', p1, { x: 200, y: 20, width: 60, height: 20 });
  return doc.save();
}
const formBytes = await makeForm();
const doc0 = await lib.PDFDocument.load(formBytes);
const fields = formFields(lib, doc0);
eq('the fillable fields, in order, buttons left out', fields.map((f) => `${f.name}:${f.kind}`), ['name:text', 'notes:text', 'code:text', 'agree:check', 'city:dropdown', 'size:radio', 'tags:list', 'locked:text']);
eq('each field knows its page', fields.map((f) => f.widgets.map((w) => w.page)), [[0], [0], [0], [0], [1], [1, 1], [1], [0]]);
eq('options of a drop-down and of radio buttons (one per widget)', [fields[4].options, fields[5].options, fields[5].widgets.map((w) => w.option)], [['Wien', 'Graz'], ['S', 'L'], ['S', 'L']]);
eq('multi-line, length limit, read-only', [fields[1].multiline, fields[2].maxLength, fields[7].readOnly, fields[0].readOnly], [true, 4, true, false]);
eq('values as they are in the file', [fields[7].value, fields[0].value, fields[3].value, fields[5].value, fields[6].value], ['fixed', '', false, '', []]);
near('a field box is a rectangle in user space', [fields[0].widgets[0].rect.x, fields[0].widgets[0].rect.width].map(Math.round), [20, 201]);
eq('a document with no form has no fields', formFields(lib, await lib.PDFDocument.create()), []);

// ---- filling ----
const filled = await lib.PDFDocument.load(formBytes);
const res = await applyForm(lib, filled, { name: 'Anna Berger', agree: true, city: 'Graz', size: 'L', notes: 'two\nlines', tags: ['b', 'c'] }, { flatten: false });
eq('everything took its value', res.failed, []);
const saved = await lib.PDFDocument.load(await filled.save());
const again = Object.fromEntries(formFields(lib, saved).map((f) => [f.name, f.value]));
eq('and keeps it in the saved file', [again.name, again.agree, again.city, again.size, again.notes, again.tags], ['Anna Berger', true, 'Graz', 'L', 'two\nlines', ['b', 'c']]);
eq('the fields are still fields', formFields(lib, saved).length, 8);
// a text field with an automatic size (0 Tf, as many real forms have) is given a readable one, so a flattened page looks like the form did
const auto = await lib.PDFDocument.load(formBytes);
for (const n of ['name', 'notes']) auto.getForm().getTextField(n).acroField.setDefaultAppearance('/Helv 0 Tf 0 g');
auto.getForm().getTextField('code').setFontSize(9);
await applyForm(lib, auto, { name: 'Anna', notes: 'two\nlines', code: 'abc' });
const da = (n) => auto.getForm().getTextField(n).acroField.getDefaultAppearance();
const sizeOf = (n) => Number(/([\d.]+)\s+Tf/.exec(da(n))[1]);
eq('an automatic one-line field gets 12 pt at most, a multi-line one 11 pt, a chosen size is kept', [sizeOf('name') <= 12 && sizeOf('name') >= 7, sizeOf('notes'), sizeOf('code')], [true, 11, 9]);
const bad = await applyForm(lib, await lib.PDFDocument.load(formBytes), { name: '日本語', code: 'toolong', nosuch: 'x' });
eq('a text too long and a field that is not there are reported', bad.failed.sort(), ['code', 'nosuch']);
eq('letters the font lacks are written as ? and listed', [bad.dropped.sort(), formFields(lib, await lib.PDFDocument.load(await (async () => { const d = await lib.PDFDocument.load(formBytes); await applyForm(lib, d, { name: '日本' }); return d.save(); })())).find((f) => f.name === 'name').value], [['日', '本', '語'].sort(), '??']);
const flat = await lib.PDFDocument.load(formBytes);
await applyForm(lib, flat, { name: 'Anna' }, { flatten: true });
const flatSaved = await lib.PDFDocument.load(await flat.save());
eq('flattened: no fields remain, no widgets either', [formFields(lib, flatSaved).length, flatSaved.getPage(0).node.Annots()?.size() ?? 0], [0, 0]);
ok('and the page now draws the text itself', flatSaved.getPage(0).node.Contents() != null);

// ---- through buildPdf ----
const sources = new Map([['s0', formBytes]]);
const load = async (id) => openDocument(lib, sources.get(id));
const all = [{ id: 'a', src: 's0', page: 0, rotate: 0 }, { id: 'b', src: 's0', page: 1, rotate: 0 }];
const keepFields = await buildPdf(lib, { load, pages: all, form: { values: new Map([['s0', { name: 'Anna' }]]), flatten: false } });
eq('editing in place with "keep the fields": still a form with the value', formFields(lib, await openDocument(lib, keepFields.bytes)).find((f) => f.name === 'name').value, 'Anna');
const leftOut = await buildPdf(lib, { load, pages: [all[0]], form: { values: new Map([['s0', { name: 'Anna' }]]), flatten: false } });
eq('with a page left out the filled fields are flattened anyway', formFields(lib, await openDocument(lib, leftOut.bytes)).length, 0);
const wanted = await buildPdf(lib, { load, pages: all, form: { values: new Map([['s0', { name: 'Anna' }]]), flatten: true } });
eq('flatten asked for', formFields(lib, await openDocument(lib, wanted.bytes)).length, 0);
const nothing = await buildPdf(lib, { load, pages: all, form: { values: new Map(), flatten: true } });
eq('nothing filled: the form is left as it is', formFields(lib, await openDocument(lib, nothing.bytes)).length, 8);
const failing = await buildPdf(lib, { load, pages: all, form: { values: new Map([['s0', { code: 'toolong', name: '日本' }]]), flatten: false } });
eq('a value that will not go in is reported, the file is still made', [failing.formFailed, failing.bytes.length > 0], [['code'], true]);
eq('and the letters the font lacks come back with the others', failing.dropped.sort(), ['日', '本'].sort());

// ---- a password ----
const locked = await buildPdf(lib, { load, pages: all, protect: { userPassword: 'open-me', ownerPassword: 'owner-secret', permissions: { printing: 'highResolution', copying: false, modifying: false } } });
let closed = null;
try { await lib.PDFDocument.load(locked.bytes); } catch (e) { closed = e instanceof lib.EncryptedPDFError; }
eq('the result cannot be opened without the password', closed, true);
eq('and opens with it', (await lib.PDFDocument.load(locked.bytes, { password: 'open-me' })).getPageCount(), 2);
let wrong = null;
try { await lib.PDFDocument.load(locked.bytes, { password: 'nope' }); } catch (e) { wrong = true; }
eq('a wrong password does not', wrong, true);
const open = await buildPdf(lib, { load, pages: all, protect: { userPassword: '' } });
eq('an empty password protects nothing', (await lib.PDFDocument.load(open.bytes)).getPageCount(), 2);

// ---- pages as pictures ----
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const textDoc = await lib.PDFDocument.create();
const font = await textDoc.embedFont(lib.StandardFonts.Helvetica);
for (const w of ['alpha', 'beta', 'gamma']) textDoc.addPage([300, 200]).drawText(w + ' secret text', { x: 20, y: 100, size: 14, font });
sources.set('t', await textDoc.save());
const three = [0, 1, 2].map((i) => ({ id: 'p' + i, src: 't', page: i, rotate: 0 }));
const asked = [];
const raster = { ids: new Set(['p1']), render: async (bytes, which) => { asked.push(which); return which.map(() => ({ bytes: PNG, type: 'png', w: 300, h: 200 })); } };
const picd = await buildPdf(lib, { load, pages: three, raster, marks: new Map([['p1', [{ id: 'm', type: 'rect', x: 0.5, y: 0.5, w: 100, h: 20, angle: 0, color: '#111827' }]]]) });
eq('the renderer was asked for the one page, from a file that already had the cover on it', asked, [[1]]);
const outPic = await lib.PDFDocument.load(picd.bytes);
eq('three pages, one of them a picture now', [outPic.getPageCount(), picd.pictures], [3, 1]);
// pdf-lib writes text as hex strings inside deflated content streams: inflate every stream and look for the hex of the words
const hexOf = (w) => Buffer.from(w, 'latin1').toString('hex');
const everything = (bytes) => {
  const raw = Buffer.from(bytes).toString('latin1');
  let all = raw;
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length, end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try { all += zlib.inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'); } catch { /* not deflated */ }
  }
  return all.toLowerCase();
};
const has = (bytes, words) => everything(bytes).includes(hexOf(words));
const control = await buildPdf(lib, { load, pages: three });
eq('control: without the picture step every page still carries its words', ['alpha', 'beta', 'gamma'].map((w) => has(control.bytes, w + ' secret text')), [true, true, true]);
eq('with it, the covered page is gone from the file and the others stay', ['alpha', 'beta', 'gamma'].map((w) => has(picd.bytes, w + ' secret text')), [true, false, true]);
const none = await buildPdf(lib, { load, pages: three, raster: { ids: new Set(), render: async () => [] } });
eq('no pages asked for: nothing is redrawn', none.pictures, 0);
const allPics = await buildPdf(lib, { load, pages: three, raster: { ids: new Set(three.map((p) => p.id)), render: async (b, which) => which.map(() => ({ bytes: PNG, type: 'png', w: 300, h: 200 })) } });
eq('all pages as pictures', allPics.pictures, 3);

eq('which pages: none', [...picturePages('none', three, new Map())], []);
eq('which pages: all', [...picturePages('all', three, new Map())], ['p0', 'p1', 'p2']);
eq('which pages: only those with a cover (a highlight or a tick is not one)', [...picturePages('covered', three, new Map([['p1', [{ type: 'rect' }]], ['p2', [{ type: 'hilite' }, { type: 'check' }]]]))], ['p1']);

// ---- a blank page ----
const blank = await lib.PDFDocument.load(await blankPdf(lib, 595.28, 841.89));
eq('a blank page: one page of the size asked', [blank.getPageCount(), Math.round(blank.getPage(0).getWidth()), Math.round(blank.getPage(0).getHeight())], [1, 595, 842]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
