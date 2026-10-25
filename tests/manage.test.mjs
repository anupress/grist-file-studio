// The file manager's edits and "where it is": replace in place and everywhere, copies after the
// original, copy and move to another record; the document-wide index and the links to cells.

import { replaceFile, replaceEverywhere, removeEverywhere, insertAfter, copyFilesTo, moveFilesTo } from '../src/model/edits.js';
import { attachmentColumns, buildIndex, placeFor, cellLink, docUrlFromBase } from '../src/model/locations.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const f = { rowId: 4, col: 'Photos', index: 1, attId: 2 };
eq('replace in place', replaceFile('Sites', f, ['L', 1, 2, 3], 9), [['UpdateRecord', 'Sites', 4, { Photos: ['L', 1, 9, 3] }]]);
eq('replace when the cell moved on', replaceFile('Sites', f, ['L', 2, 3], 9), [['UpdateRecord', 'Sites', 4, { Photos: ['L', 9, 3] }]]);
eq('replace a file that is gone', replaceFile('Sites', f, ['L', 5], 9), null);
const cells = { 'Sites|4|Photos': ['L', 1, 2], 'Sites|7|Docs': ['L', 2, 2], 'Reports|1|Files': ['L', 2], 'Reports|2|Files': ['L', 8] };
eq('replace everywhere, one action per cell, every occurrence', replaceEverywhere([
  { tableId: 'Sites', rowId: 4, colId: 'Photos' }, { tableId: 'Sites', rowId: 7, colId: 'Docs' }, { tableId: 'Sites', rowId: 7, colId: 'Docs' },
  { tableId: 'Reports', rowId: 1, colId: 'Files' }, { tableId: 'Reports', rowId: 2, colId: 'Files' },
], 2, 9, (t, r, c) => cells[`${t}|${r}|${c}`]), [
  ['UpdateRecord', 'Sites', 4, { Photos: ['L', 1, 9] }],
  ['UpdateRecord', 'Sites', 7, { Docs: ['L', 9, 9] }],
  ['UpdateRecord', 'Reports', 1, { Files: ['L', 9] }],
]);
const withFormula = [{ tableId: 'Sites', rowId: 4, colId: 'Photos' }, { tableId: 'Reports', rowId: 1, colId: 'Files', isFormula: true }];
eq('replace everywhere leaves formula cells alone', replaceEverywhere(withFormula, 2, 9, (t, r, c) => cells[`${t}|${r}|${c}`]), [
  ['UpdateRecord', 'Sites', 4, { Photos: ['L', 1, 9] }],
]);
eq('remove everywhere: every occurrence, every cell, emptied cells become empty', removeEverywhere([
  { tableId: 'Sites', rowId: 4, colId: 'Photos' }, { tableId: 'Sites', rowId: 7, colId: 'Docs' }, { tableId: 'Sites', rowId: 4, colId: 'Photos' },
  { tableId: 'Reports', rowId: 1, colId: 'Files' }, { tableId: 'Reports', rowId: 2, colId: 'Files' },
], 2, (t, r, c) => cells[`${t}|${r}|${c}`]), [
  ['UpdateRecord', 'Sites', 4, { Photos: ['L', 1] }],
  ['UpdateRecord', 'Sites', 7, { Docs: null }],
  ['UpdateRecord', 'Reports', 1, { Files: null }],
]);
eq('remove everywhere skips formula cells', removeEverywhere(withFormula, 2, (t, r, c) => cells[`${t}|${r}|${c}`]), [
  ['UpdateRecord', 'Sites', 4, { Photos: ['L', 1] }],
]);
eq('a copy goes right after the original', insertAfter('Sites', f, ['L', 1, 2, 3], 9), [['UpdateRecord', 'Sites', 4, { Photos: ['L', 1, 2, 9, 3] }]]);
eq('copy to another record, no doubles', copyFilesTo('Sites', [{ attId: 2 }, { attId: 3 }, { attId: 2 }], 8, 'Photos', ['L', 3]), [['UpdateRecord', 'Sites', 8, { Photos: ['L', 3, 2] }]]);
eq('copy of files already there does nothing', copyFilesTo('Sites', [{ attId: 3 }], 8, 'Photos', ['L', 3]), []);
const cur = (r, c) => ({ '4Photos': ['L', 1, 2, 3], '8Photos': ['L', 7], '4Docs': ['L', 5] })[r + c];
eq('move: out of the source, into the target, one bundle', moveFilesTo('Sites', [{ rowId: 4, col: 'Photos', index: 1, attId: 2 }, { rowId: 4, col: 'Docs', index: 0, attId: 5 }], 8, 'Photos', cur), [
  ['UpdateRecord', 'Sites', 4, { Photos: ['L', 1, 3] }],
  ['UpdateRecord', 'Sites', 4, { Docs: null }],
  ['UpdateRecord', 'Sites', 8, { Photos: ['L', 7, 2, 5] }],
]);
eq('move to the cell it is in does nothing', moveFilesTo('Sites', [{ rowId: 4, col: 'Photos', index: 0, attId: 1 }], 4, 'Photos', cur), []);

// ---- where it is ----
const metaTables = [{ id: 1, tableId: 'Sites' }, { id: 2, tableId: 'Reports' }, { id: 3, tableId: 'GristSummary_5_Sites', summarySourceTable: 1 }];
const metaColumns = [
  { id: 10, parentId: 1, colId: 'Photos', type: 'Attachments', label: 'Photos' }, { id: 11, parentId: 1, colId: 'Name', type: 'Text' },
  { id: 20, parentId: 2, colId: 'Files', type: 'Attachments', label: 'Files', isFormula: true, formula: '$Site.Photos' },
  { id: 30, parentId: 3, colId: 'All', type: 'Attachments' },
];
const cols = attachmentColumns(metaTables, metaColumns);
eq('attachment columns of person-made tables', cols.map((c) => [c.tableId, c.colId, c.colRef, c.isFormula]), [['Sites', 'Photos', 10, false], ['Reports', 'Files', 20, true]]);
const index = buildIndex(cols, [{ tableId: 'Sites', rows: [{ id: 1, Photos: ['L', 5, 6] }, { id: 2, Photos: [5] }] }, { tableId: 'Reports', rows: [{ id: 9, Files: ['L', 6] }] }]);
eq('index: every place of a file', index.get(6), [{ tableId: 'Sites', colId: 'Photos', colRef: 10, rowId: 1, index: 1, isFormula: false }, { tableId: 'Reports', colId: 'Files', colRef: 20, rowId: 9, index: 0, isFormula: true }]);
eq('index: bare lists count too', index.get(5).map((p) => p.rowId), [1, 2]);
const sections = [{ id: 4, parentId: 1, tableRef: 1, parentKey: 'single' }, { id: 6, parentId: 2, tableRef: 1, parentKey: 'record' }, { id: 7, parentId: 9, tableRef: 2, parentKey: 'record' }];
const pages = [{ viewRef: 1, pagePos: 1 }, { viewRef: 2, pagePos: 2 }];
eq('a table widget on a page is preferred', placeFor(1, { sections, pages }), { viewRef: 2, sectionRef: 6 });
eq('a table on no page opens in raw data', placeFor(2, { sections, pages, rawSectionRef: 12 }), { raw: true, sectionRef: 12 });
eq('doc url from the API base', [docUrlFromBase('https://docs.getgrist.com/api/docs/new~abc'), docUrlFromBase('https://grist.example.com/o/docs/api/docs/x1Y2')], ['https://docs.getgrist.com/doc/new~abc', 'https://grist.example.com/o/docs/doc/x1Y2']);
eq('cell link', cellLink('https://docs.getgrist.com/doc/abc', { viewRef: 2, sectionRef: 6 }, { rowId: 9, colRef: 10 }), 'https://docs.getgrist.com/doc/abc/p/2#a1.s6.r9.c10');
eq('raw data link', cellLink('https://docs.getgrist.com/doc/abc', { raw: true, sectionRef: 12 }, { rowId: 9, colRef: 20 }), 'https://docs.getgrist.com/doc/abc/p/data#a1.s12.r9.c20');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
