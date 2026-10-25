// Folders (a folder is a record): the actions that make and rename one, showing records that have no file yet, and where they sit in the layout.

import { cleanName, canName, newFolder, renameFolder, showsEmpty, newestId, folderStats, clipFiles, canDeleteFolder, deleteFolderActions, MAX_NAME } from '../src/model/folders.js';
import { visibleFiles } from '../src/model/files.js';
import { layoutFiles, HEAD_H, EMPTY_H } from '../src/model/layout.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const title = { id: 'Title', kind: 'Text', isFormula: false };
eq('a name is tidied and cut', [cleanName('  Hafen   12 '), cleanName('x'.repeat(500)).length, cleanName('  '), cleanName(null)], ['Hafen 12', MAX_NAME, '', '']);
eq('which columns can hold a name: plain text only', [canName(title), canName({ ...title, isFormula: true }), canName({ id: 'N', kind: 'Numeric' }), canName({ id: 'C', kind: 'Choice' }), canName(null)], [true, false, false, false, false]);

eq('a new folder is one new record with its name', newFolder('Sites', ' Hafen  12 ', { titleCol: title }), [['AddRecord', 'Sites', null, { Title: 'Hafen 12' }]]);
eq('a new folder carries the value a Select-by link needs', newFolder('Sites', 'A', { titleCol: title, prefill: { col: 'Project', value: 7 } }), [['AddRecord', 'Sites', null, { Title: 'A', Project: 7 }]]);
eq('the link value never overwrites the name', newFolder('Sites', 'A', { titleCol: title, prefill: { col: 'Title', value: 7 } }), [['AddRecord', 'Sites', null, { Title: 'A' }]]);
eq('no name, no column, a formula column: nothing is written', [
  newFolder('Sites', '  ', { titleCol: title }), newFolder('Sites', 'A', {}), newFolder('Sites', 'A', { titleCol: { ...title, isFormula: true } }), newFolder('Sites', 'A', { titleCol: { id: 'N', kind: 'Numeric' } }),
], [[], [], [], []]);

eq('renaming a folder updates the name cell', renameFolder('Sites', 4, 'New name', { titleCol: title, current: 'Old' }), [['UpdateRecord', 'Sites', 4, { Title: 'New name' }]]);
eq('the same name (spaces aside), an empty one, a formula column: nothing', [
  renameFolder('Sites', 4, ' Old ', { titleCol: title, current: 'Old' }), renameFolder('Sites', 4, '', { titleCol: title, current: 'Old' }), renameFolder('Sites', 4, 'X', { titleCol: { ...title, isFormula: true }, current: 'Old' }),
], [[], [], []]);

eq('the new record is the largest id that was not there before', [newestId([{ id: 1 }, { id: 2 }, { id: 5 }, { id: 4 }], new Set([1, 2, 4])), newestId([{ id: 1 }], new Set([1])), newestId([], new Set())], [5, null, null]);

const file = (key, name) => ({ key, name, group: 'image', ext: 'jpg', size: 1, tags: [], notesText: '', uploaded: 1 });
const gallery = { records: [
  { rowId: 1, title: 'Testgasse', fields: [], files: [file('a', 'one.jpg'), file('b', 'two.jpg')] },
  { rowId: 2, title: 'Empty folder', fields: [], files: [] },
  { rowId: 3, title: 'Another empty one', fields: [], files: [] },
  { rowId: 4, title: 'Hafen', fields: [], files: [file('c', 'three.jpg')] },
] };
const ids = (o) => visibleFiles(gallery, o).groups.map((g) => g.rec.rowId);
eq('records without files are left out by default', ids({}), [1, 4]);
eq('all of them on request, in table order', ids({ empty: true }), [1, 2, 3, 4]);
eq('only the folders in a set (made in this visit)', ids({ empty: new Set([3]) }), [1, 3, 4]);
eq('the files in order do not include any for an empty folder', visibleFiles(gallery, { empty: true }).files.map((f) => f.key), ['a', 'b', 'c']);
eq('a search, a type chip or a tag narrows the wall: empty folders go', [ids({ empty: true, query: 'one' }), ids({ empty: true, group: 'pdf' }), ids({ empty: true, tag: 'x' })], [[1], [], []]);
eq('showsEmpty: needs no file, and asked for', [
  showsEmpty({ rowId: 2, files: [] }, { empty: true }), showsEmpty({ rowId: 2, files: [] }, { empty: new Set([2]) }), showsEmpty({ rowId: 2, files: [] }, { empty: new Set([9]) }),
  showsEmpty({ rowId: 1, files: [file('a', 'x')] }, { empty: true }), showsEmpty({ rowId: 2, files: [] }, { empty: true, narrowed: true }), showsEmpty({ rowId: 2, files: [] }, {}),
], [true, true, false, false, false, false]);

// the layout: a header, then a line that says the folder is empty, then the next folder
const groups = visibleFiles(gallery, { empty: true }).groups;
const lay = layoutFiles(groups, { width: 800, size: 160, fixed: null });
const kinds = lay.blocks.map((b) => b.kind + b.g);
eq('blocks: header and rows, then header and empty line for each empty folder', kinds.filter((k) => !k.startsWith('row')), ['head0', 'head1', 'empty1', 'head2', 'empty2', 'head3']);
const empty1 = lay.blocks.find((b) => b.kind === 'empty' && b.g === 1), head1 = lay.blocks.find((b) => b.kind === 'head' && b.g === 1), head2 = lay.blocks.find((b) => b.kind === 'head' && b.g === 2);
eq('the empty line sits right under its header and the next folder follows with a gap', [empty1.y - head1.y, empty1.h, head2.y - empty1.y], [HEAD_H, EMPTY_H, EMPTY_H + 10]);
eq('not grouped: no headings, so nothing is drawn for an empty folder', layoutFiles([{ rec: null, files: [] }], { width: 800, size: 160, grouped: false }).blocks, []);


// Properties: counts, bytes, stored once per content hash, by type, the largest, the first and last upload
const sized = (key, group, size, ident, uploaded) => ({ key, name: key + '.x', group, size, ident, uploaded });
const st = folderStats([sized('a', 'image', 2000000, 'h1', 1000), sized('b', 'image', 1000000, 'h2', 3000), sized('c', 'pdf', 500000, 'h3', 2000), sized('d', 'image', 2000000, 'h1', 4000)]);
eq('folder stats: count, bytes, stored once per hash', [st.count, st.bytes, st.stored], [4, 5500000, 3500000]);
eq('folder stats: by type, biggest first', st.groups, [{ group: 'image', count: 3, bytes: 5000000 }, { group: 'pdf', count: 1, bytes: 500000 }]);
eq('folder stats: largest, first and last upload', [st.largest.key, st.first, st.last], ['a', 1000, 4000]);
eq('folder stats of nothing', folderStats([]), { count: 0, bytes: 0, stored: 0, groups: [], largest: null, first: null, last: null });
eq('files without a size or a hash still count', [folderStats([{ key: 'z', group: 'other' }]).count, folderStats([{ key: 'z', group: 'other' }, { key: 'y', group: 'other' }]).stored], [1, 0]);

// The inside clipboard: keys that still point at a file
const shelf = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
eq('clip files: the ones still there, in the order of the files', clipFiles({ mode: 'copy', keys: ['c', 'a', 'gone'] }, shelf).map((x) => x.key), ['a', 'c']);
eq('clip files: nothing on the clipboard, or an empty one', [clipFiles(null, shelf), clipFiles({ mode: 'cut', keys: [] }, shelf), clipFiles({ mode: 'cut', keys: ['z'] }, shelf)], [[], [], []]);

// deleting: only an empty folder
eq('only a folder with no file and no folder inside may be deleted', [canDeleteFolder({ files: [] }, { children: [] }), canDeleteFolder({ files: [{}] }, { children: [] }), canDeleteFolder({ files: [] }, { children: [{}] }), canDeleteFolder({ files: [] }, null), canDeleteFolder(null, null)], [true, false, false, true, false]);
eq('the delete is one RemoveRecord', deleteFolderActions('Sites', 4), [['RemoveRecord', 'Sites', 4]]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
