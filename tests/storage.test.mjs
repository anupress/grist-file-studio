// Where the space goes: counting, what removing really frees, what could shrink, the allowance bar.

import { entriesOf, summarize, estimateAfter, shrinkCandidates, fill, defaultLimit, SHRINKABLE } from '../src/model/storage.js';
import { replaceMany, removeManyEverywhere } from '../src/model/edits.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const near = (n, got, want, eps = 1) => { if (Math.abs(got - want) <= eps) pass++; else { fail++; console.log(`  FAIL ${n}: got ${got}, want ${want}`); } };

// rows as Grist keeps them: ids 1 and 3 are the same bytes uploaded twice
const rows = [
  { id: 1, fileName: 'kitchen.jpg', fileExt: '.jpg', fileSize: 4000000, fileIdent: 'aaa', imageWidth: 4000, imageHeight: 3000, timeDeleted: null },
  { id: 2, fileName: 'report.pdf', fileExt: '.pdf', fileSize: 900000, fileIdent: 'bbb', imageWidth: 0, imageHeight: 0, timeDeleted: null },
  { id: 3, fileName: 'kitchen copy.jpg', fileExt: '.jpg', fileSize: 4000000, fileIdent: 'aaa', imageWidth: 4000, imageHeight: 3000, timeDeleted: null },
  { id: 4, fileName: 'old draft.pdf', fileExt: '.pdf', fileSize: 600000, fileIdent: 'ccc', timeDeleted: 1792939718.007 },
  { id: 5, fileName: 'video.mp4', fileExt: '.mp4', fileSize: 30000000, fileIdent: 'ddd', timeDeleted: null },
  { id: 6, fileName: 'removed but shared.jpg', fileExt: '.jpg', fileSize: 4000000, fileIdent: 'aaa', timeDeleted: 1792939718 },
  { id: 7, fileName: 'small.png', fileExt: '.png', fileSize: 20000, fileIdent: 'eee', imageWidth: 100, imageHeight: 100 },
  { id: 8, fileName: 'nobody.png', fileExt: '.png', fileSize: 2500000, fileIdent: 'fff', imageWidth: 2000, imageHeight: 1500 },
];
const cells = { 1: [{}], 2: [{}, {}], 3: [{}], 5: [{}], 7: [{}] };   // the cells that hold each file
const entries = entriesOf(rows, (id) => cells[id]);
eq('an entry per row, with its uses', entries.map((e) => [e.id, e.uses, e.used]), [[1, 1, true], [2, 2, true], [3, 1, true], [4, 0, false], [5, 1, true], [6, 0, false], [7, 1, true], [8, 0, false]]);
eq('the extension is read from Grist or the name', entries[0].ext, 'jpg');
const s = summarize(entries);
eq('the same bytes under two names count once in total: 4 MB + 0.9 + 0.6 + 30 + 0.02 + 2.5', s.total.bytes, 4000000 + 900000 + 600000 + 30000000 + 20000 + 2500000);
eq('total files are distinct contents, rows are every row', [s.total.files, s.total.rows], [6, 8]);
eq('in use: kitchen, report, video, small', [s.inUse.files, s.inUse.bytes], [4, 4000000 + 900000 + 30000000 + 20000]);
eq('unused rows: the draft, the shared one, nobody.png', s.unused.rows, 3);
eq('removing them frees only the contents no used row shares (draft + nobody, not the shared photo)', [s.unused.files, s.unused.bytes], [2, 600000 + 2500000]);
eq('the unused list is biggest first', s.unused.list.map((e) => e.id), [6, 8, 4]);
eq('biggest in use, one per content', s.biggest.map((b) => [b.name, b.size, b.uses]), [['video.mp4', 30000000, 1], ['kitchen.jpg', 4000000, 2], ['report.pdf', 900000, 2], ['small.png', 20000, 1]]);
eq('the kitchen content lists both rows that use it', s.biggest[1].ids, [1, 3]);
eq('by kind: video, pictures, pdf', s.byKind.map((k) => [k.kind, k.files, k.bytes]), [['video', 1, 30000000], ['image', 2, 4020000], ['pdf', 1, 900000]]);
eq('an empty document', summarize([]).total, { rows: 0, files: 0, bytes: 0 });
eq('a row without a hash is its own content', summarize(entriesOf([{ id: 1, fileName: 'a.txt', fileSize: 10 }, { id: 2, fileName: 'b.txt', fileSize: 20 }], () => [{}])).total.files, 2);

// shrinking
const big = s.biggest.find((b) => b.name === 'kitchen.jpg');
near('a 12 MP, 4 MB JPEG at 2560 px: about 4.9 MP x 0.2 byte', estimateAfter(big, 2560), 4000 * 3000 * (2560 / 4000) ** 2 * 0.2, 2);
eq('a picture without known size is guessed at half', estimateAfter({ size: 1000, w: 0, h: 0, ext: 'jpg' }, 2560), 500);
eq('a PNG shrinks with its pixels', estimateAfter({ size: 1000000, w: 4000, h: 2000, ext: 'png' }, 2000), Math.round(1000000 * 0.25 * 0.9));
eq('a picture already small is not made bigger', estimateAfter({ size: 200000, w: 800, h: 600, ext: 'jpg' }, 2560) <= 190000, true);
const cands = shrinkCandidates(s.biggest, { maxSide: 2560 });
eq('only the big photo is a candidate (video, pdf and the tiny png are not)', cands.map((c) => c.name), ['kitchen.jpg']);
eq('it saves about 3 MB', Math.round(cands[0].saves / 1e6), 3);
eq('a lower side finds more', shrinkCandidates([{ key: 'k', name: 'b.jpg', ext: 'jpg', size: 500000, w: 2000, h: 1500, uses: 1, ids: [1] }], { maxSide: 1024 }).length, 1);
eq('a photo under the minimum is left alone', shrinkCandidates([{ key: 'k', name: 'b.jpg', ext: 'jpg', size: 100000, w: 4000, h: 3000, uses: 1, ids: [1] }], { maxSide: 1024 }).length, 0);
eq('a heavy photo with few pixels is a candidate', shrinkCandidates([{ key: 'k', name: 'b.jpg', ext: 'jpg', size: 3000000, w: 1500, h: 1000, uses: 1, ids: [1] }], { maxSide: 2560 }).length, 1);
eq('HEIC and GIF are not touched', ['heic', 'gif', 'svg'].some((x) => SHRINKABLE.has(x)), false);

// the allowance
eq('no limit, no bar', fill(5e8, null), null);
eq('a third of 1 GB', fill(3.3e8, 1e9).state, 'ok');
eq('80 % is near', fill(8e8, 1e9).state, 'near');
eq('over', fill(1.2e9, 1e9).state, 'over');
eq('hosted Grist with its own store: 1 GB', defaultLimit({ host: 'docs.getgrist.com', store: 'internal' }), 1e9);
eq('a team site on getgrist.com too', defaultLimit({ host: 'acme.getgrist.com', store: 'internal' }), 1e9);
eq('external storage: no known limit', defaultLimit({ host: 'docs.getgrist.com', store: 'external' }), null);
eq('self-hosted: no known limit', defaultLimit({ host: 'grist.example.org', store: 'internal' }), null);

// replacing many files at once
const places = { 1: [{ tableId: 'Sites', rowId: 1, colId: 'Photos' }, { tableId: 'Archive', rowId: 1, colId: 'Files' }], 2: [{ tableId: 'Sites', rowId: 1, colId: 'Photos' }], 3: [{ tableId: 'Sites', rowId: 9, colId: 'Photos', isFormula: true }] };
const current = { 'Sites|1|Photos': ['L', 1, 7, 2], 'Archive|1|Files': ['L', 1], 'Sites|9|Photos': ['L', 3] };
const acts = replaceMany((id) => places[id], new Map([[1, 11], [2, 12], [3, 13]]), (t, r, c) => current[`${t}|${r}|${c}`]);
eq('two files of one cell change in ONE action; another table; the formula cell is left alone', acts, [
  ['UpdateRecord', 'Sites', 1, { Photos: ['L', 11, 7, 12] }],
  ['UpdateRecord', 'Archive', 1, { Files: ['L', 11] }],
]);
eq('a file that left the cell meanwhile changes nothing', replaceMany((id) => places[id], new Map([[2, 12]]), () => ['L', 7]), []);

eq('two rows of one content out of every cell, one action per cell', removeManyEverywhere((id) => places[id], [1, 2], (t, r, c) => current[`${t}|${r}|${c}`]), [
  ['UpdateRecord', 'Sites', 1, { Photos: ['L', 7] }],
  ['UpdateRecord', 'Archive', 1, { Files: null }],
]);
eq('a formula cell is left to its formula', removeManyEverywhere((id) => places[id], [3], (t, r, c) => current[`${t}|${r}|${c}`]), []);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
