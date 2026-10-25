// File kinds, cell values, role detection and the gallery built from rows: the model every layout reads.

import { extOf, baseOf, kindOf, mimeOf, groupOf, typeLabel, sizeText } from '../src/model/kinds.js';
import { attachmentIds, cellText, refId } from '../src/model/values.js';
import { detectRoles, fromStored, toStored, resolveRoles } from '../src/model/roles.js';
import { metaFromRows, buildGallery, coverOf, visibleFiles, visibleRecords, groupCounts, sortFiles, matcher } from '../src/model/files.js';
import { columnsFromFixture } from '../src/model/schema.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

// ---- kinds ----
eq('ext from a name', [extOf('IMG_0042.JPG'), extOf('.pdf'), extOf('README'), extOf('a.tar.gz'), extOf('weird.名前')], ['jpg', 'pdf', '', 'gz', '']);
eq('base', [baseOf('Site plan.final.pdf'), baseOf('README'), baseOf('x.JPG')], ['Site plan.final', 'README', 'x']);
eq('kinds', ['jpg', 'HEIC', 'pdf', 'mov', 'm4a', 'csv', 'docx', ''].map(kindOf), ['image', 'heic', 'pdf', 'video', 'audio', 'text', 'other', 'other']);
eq('groups', ['image', 'heic', 'text', 'other', 'pdf'].map(groupOf), ['image', 'image', 'other', 'other', 'pdf']);
eq('mime', [mimeOf('MP4'), mimeOf('.mp3'), mimeOf('xyz')], ['video/mp4', 'audio/mpeg', 'application/octet-stream']);
eq('type label', [typeLabel('docx'), typeLabel(''), typeLabel('.pdf')], ['DOCX', 'FILE', 'PDF']);
eq('sizes', [sizeText(812), sizeText(14200), sizeText(3_400_000), sizeText(1_230_000_000)], ['812 B', '14 kB', '3.4 MB', '1.2 GB']);
eq('sizes in German', sizeText(3_400_000, 'de'), '3,4 MB');

// ---- values ----
eq('attachment cells', [attachmentIds(['L', 3, 4]), attachmentIds(null), attachmentIds(['L']), attachmentIds(['E', 'TypeError']), attachmentIds(7), attachmentIds([5, 6])], [[3, 4], [], [], [], [7], [5, 6]]);
eq('ref id', [refId(['R', 'People', 3]), refId(0), refId(null)], [3, 0, 0]);
const C = (id, type, extra = {}) => ({ ...columnsFromFixture([{ id, type }])[0], ...extra });
eq('cell text', [
  cellText('Hafenstraße', C('Name', 'Text')),
  cellText(['d', Date.UTC(2026, 9, 25) / 1000], C('Due', 'Date')),
  cellText(['R', 'People', 2], C('Owner', 'Ref:People'), new Map([[2, 'Anna']])),
  cellText(['L', 'red', 'blue'], C('Tags', 'ChoiceList')),
  cellText(true, C('Ok', 'Bool')),
  cellText(false, C('Ok', 'Bool')),
  cellText(['E', 'TypeError'], C('X', 'Any')),
  cellText(12.5, C('Price', 'Numeric'), null, { number: (n) => n.toFixed(2) }),
], ['Hafenstraße', '2026-10-25', 'Anna', 'red, blue', '✓', null, '#TypeError', '12.50']);

// ---- roles ----
const cols = columnsFromFixture([
  { id: 'Code', type: 'Text' }, { id: 'Name', type: 'Text' }, { id: 'Location', type: 'Ref:Places' },
  { id: 'Photos', type: 'Attachments' }, { id: 'Docs', type: 'Attachments' }, { id: 'Checked', type: 'Date' },
]);
eq('detection', detectRoles(cols), { files: ['Photos', 'Docs'], title: 'Name', fields: ['Code', 'Location'], parent: null });
eq('German title', detectRoles(columnsFromFixture([{ id: 'Nr', type: 'Int' }, { id: 'Bezeichnung', type: 'Text' }, { id: 'Bilder', type: 'Attachments' }])).title, 'Bezeichnung');
eq('first text column when nothing is named', detectRoles(columnsFromFixture([{ id: 'A', type: 'Numeric' }, { id: 'B', type: 'Text' }, { id: 'C', type: 'Text' }])).title, 'B');
eq('no attachments column', detectRoles(columnsFromFixture([{ id: 'Name', type: 'Text' }])).files, []);
const stored = toStored({ files: ['Docs'], title: 'Code', fields: ['Checked'] }, cols);
eq('stored by ref', stored, { files: [{ ref: 5, id: 'Docs' }], title: { ref: 1, id: 'Code' }, fields: [{ ref: 6, id: 'Checked' }], parent: null });
const renamed = cols.map((c) => (c.id === 'Docs' ? { ...c, id: 'Documents' } : c));
eq('a renamed column is found by its ref', fromStored(stored, renamed).files, ['Documents']);
eq('a column that became Text is dropped', fromStored({ files: [{ ref: 4, id: 'Photos' }] }, cols.map((c) => (c.id === 'Photos' ? { ...c, kind: 'Text' } : c))).files, []);
eq('saved without files falls back to detection', resolveRoles({ files: [], title: { ref: 2, id: 'Name' }, fields: [] }, cols).files, ['Photos', 'Docs']);
eq('saved empty fields stay empty', resolveRoles({ files: [], fields: [] }, cols).fields, []);

// ---- gallery ----
const meta = metaFromRows([
  { id: 1, fileName: 'front.jpg', fileExt: '.jpg', fileSize: 1000, fileIdent: 'aa.jpg', imageWidth: 2400, imageHeight: 1600, timeUploaded: 3000 },
  { id: 2, fileName: 'plan.pdf', fileExt: '.pdf', fileSize: 500, fileIdent: 'bb.pdf', imageWidth: 0, imageHeight: 0, timeUploaded: 1000 },
  { id: 3, fileName: 'Walk.MP4', fileExt: '', fileSize: 9000, fileIdent: 'cc.mp4', timeUploaded: 2000 },
  { id: 4, fileName: 'gone.jpg', fileExt: '.jpg', fileSize: 1, fileIdent: 'dd.jpg', timeDeleted: 5 },
]);
eq('meta: kinds from the extension, deleted files left out', [...meta.values()].map((m) => [m.id, m.kind]), [[1, 'image'], [2, 'pdf'], [3, 'video']]);
const rows = [
  { id: 10, Code: 'A1', Name: 'Testgasse 7', Location: ['R', 'Places', 1], Photos: ['L', 1, 3], Docs: ['L', 2], Checked: null },
  { id: 11, Code: 'A2', Name: 'Hafenstraße 12', Location: 0, Photos: ['L', 4, 99], Docs: ['E', 'TypeError'], Checked: null },
  { id: 12, Code: 'A3', Name: 'Empty', Location: 0, Photos: null, Docs: null, Checked: null },
];
const g = buildGallery({ rows, columns: cols, roles: detectRoles(cols), meta, labels: { Location: new Map([[1, 'Vienna']]) } });
eq('records in row order', g.records.map((r) => [r.rowId, r.title, r.files.length]), [[10, 'Testgasse 7', 3], [11, 'Hafenstraße 12', 0], [12, 'Empty', 0]]);
eq('files: columns in order, cell order inside', g.files.map((f) => [f.attId, f.col, f.index, f.kind]), [[1, 'Photos', 0, 'image'], [3, 'Photos', 1, 'video'], [2, 'Docs', 0, 'pdf']]);
eq('missing and broken cells are counted', [g.missing, g.errors], [2, 1]);
eq('fields with reference labels', g.records[0].fields, [{ id: 'Code', label: 'Code', text: 'A1' }, { id: 'Location', label: 'Location', text: 'Vienna' }]);
eq('file keys are unique per place', new Set(g.files.map((f) => f.key)).size, 3);
eq('cover is the first picture', coverOf(g.records[0]).attId, 1);
eq('cover of a record with only a PDF', coverOf({ files: [g.files[2]] }).attId, 2);
const formulaCols = cols.map((c) => (c.id === 'Docs' ? { ...c, isFormula: true } : c));
eq('files of a formula column are read-only', buildGallery({ rows, columns: formulaCols, roles: detectRoles(cols), meta }).files.map((f) => f.readOnly), [false, false, true]);

eq('chip counts', groupCounts(g.files), { all: 3, image: 1, pdf: 1, video: 1, audio: 0, other: 0 });
eq('visible: a group', visibleFiles(g, { group: 'pdf' }).files.map((f) => f.attId), [2]);
eq('visible: search matches the file name', visibleFiles(g, { query: 'walk' }).files.map((f) => f.attId), [3]);
eq('visible: search matches the record', visibleFiles(g, { query: 'testgasse' }).files.length, 3);
eq('visible: accents and case do not matter', visibleFiles(g, { query: 'HAFENSTRASSE' }).groups.length, 0);
eq('visible: records without files are left out of Files', visibleFiles(g).groups.length, 1);
eq('cards keep records without files', visibleRecords(g).length, 3);
eq('cards search', visibleRecords(g, { query: 'empty' }).map((r) => r.rowId), [12]);
eq('sort by newest', sortFiles(g.files, 'newest').map((f) => f.attId), [1, 3, 2]);
eq('sort by size', sortFiles(g.files, 'largest').map((f) => f.attId), [3, 1, 2]);
eq('sort by name is natural', sortFiles([{ name: 'img10.jpg' }, { name: 'img2.jpg' }, { name: 'Img1.jpg' }], 'name').map((f) => f.name), ['Img1.jpg', 'img2.jpg', 'img10.jpg']);
eq('a matcher needs every word', [matcher('front plan')('front.jpg', 'plan'), matcher('front plan')('front.jpg')], [true, false]);

// the folder column: a Reference to this table, found by its name only
const fcols = columnsFromFixture([{ id: 'Name', type: 'Text' }, { id: 'Photos', type: 'Attachments' }, { id: 'Parent', type: 'Ref:Sites' }, { id: 'Manager', type: 'Ref:Sites' }, { id: 'Owner', type: 'Ref:People' }]);
eq('parent: a Reference to this table named Parent', detectRoles(fcols, 'Sites').parent, 'Parent');
eq('parent: not found without the table, not for another table, not for a column with another name', [detectRoles(fcols).parent, detectRoles(fcols, 'People').parent, detectRoles(columnsFromFixture([{ id: 'Manager', type: 'Ref:Sites' }]), 'Sites').parent], [null, null, null]);
eq('parent: German and French names', [detectRoles(columnsFromFixture([{ id: 'Ordner', type: 'Ref:Orte' }]), 'Orte').parent, detectRoles(columnsFromFixture([{ id: 'Dossier', type: 'Ref:Lieux' }]), 'Lieux').parent], ['Ordner', 'Dossier']);
eq('parent: a formula column cannot be written to', detectRoles(columnsFromFixture([{ id: 'Parent', type: 'Ref:Sites', isFormula: true, formula: '$A' }]), 'Sites').parent, null);
const storedF = toStored({ files: ['Photos'], title: 'Name', fields: [], parent: 'Manager' }, fcols);
eq('parent: stored by ref and found again', [storedF.parent.id, resolveRoles(storedF, fcols, 'Sites').parent], ['Manager', 'Manager']);
eq('parent: chosen as none stays none, saved before there was one follows detection', [resolveRoles({ ...storedF, parent: null }, fcols, 'Sites').parent, resolveRoles({ files: storedF.files, title: storedF.title, fields: [] }, fcols, 'Sites').parent], [null, 'Parent']);
eq('parent: a saved column that is no longer a Reference to the table is dropped', resolveRoles(toStored({ files: ['Photos'], title: 'Name', fields: [], parent: 'Owner' }, fcols), fcols, 'Sites').parent, 'Parent');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
