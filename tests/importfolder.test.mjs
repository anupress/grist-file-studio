// Importing a folder: which names are left out, the plan (records per folder, nested or flat), the ids, the one action, and reading a dropped
// folder's entries (with fake entries: a real drop cannot be made without a person).

import { skipName, splitPath, planImport, nextIds, importActions, topFolders, MAX_IMPORT_FILES } from '../src/model/importfolder.js';
import { droppedFiles, walkEntries, listFromInput, hasFolders } from '../src/media/dropwalk.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

eq('names left out: dot files, Office lock files, Windows thumbnails', ['.DS_Store', '.git', '~$offer.docx', 'Thumbs.db', 'desktop.ini', 'THUMBS.DB'].map(skipName), [true, true, true, true, true, true]);
eq('names kept', ['offer.docx', 'a.pdf', 'Thumbs.png', 'my.desktop.ini.txt', 'x~$y'].map(skipName), [false, false, false, false, false]);
eq('a path is split on both slashes', [splitPath('A/B/c.pdf'), splitPath('A\\B\\c.pdf'), splitPath('//A//c'), splitPath('')], [['A', 'B', 'c.pdf'], ['A', 'B', 'c.pdf'], ['A', 'c'], []]);

const it = (path, size = 10) => ({ path, size });
const tree = [it('Customer/offer.pdf', 5), it('Customer/2024/b.pdf', 7), it('Customer/2024/a10.pdf'), it('Customer/2024/a2.pdf'), it('Customer/2025/Q1/c.png'), it('Customer/.DS_Store'), it('Customer/~$lock.docx'), it('loose.txt', 3)];
const nested = planImport(tree, { nest: true });
eq('nested: a record per folder on the way to a file, parents first', nested.folders.map((f) => [f.index, f.path, f.name, f.parent]), [
  [0, 'Customer', 'Customer', null], [1, 'Customer/2024', '2024', 0], [2, 'Customer/2025', '2025', 0], [3, 'Customer/2025/Q1', 'Q1', 2],
]);
eq('nested: the files of each folder, in natural name order', nested.folders.map((f) => f.files.map((x) => x.name)), [['offer.pdf'], ['a2.pdf', 'a10.pdf', 'b.pdf'], [], ['c.png']]);
eq('a loose file stays loose; hidden files are counted as skipped, not as files', [nested.loose.length, nested.count], [1, { folders: 4, files: 6, bytes: 5 + 7 + 10 + 10 + 10 + 3, skipped: 2, deepest: 3 }]);
eq('the folders at the top', topFolders(nested).map((f) => f.name), ['Customer']);

const flat = planImport(tree, { nest: false });
eq('flat: only folders that hold files, named by their path', flat.folders.map((f) => [f.index, f.name, f.parent, f.files.length]), [[0, 'Customer', null, 1], [1, 'Customer / 2024', null, 3], [2, 'Customer / 2025 / Q1', null, 1]]);

eq('the records come in name order whatever order the files were listed in, folders with numbers naturally', planImport([it('T/b/1.txt'), it('T/10/1.txt'), it('T/2/1.txt'), it('T/a/1.txt')], { nest: true }).folders.map((f) => f.path), ['T', 'T/2', 'T/10', 'T/a', 'T/b']);
eq('flat: the same order, by path', planImport([it('T/b/1.txt'), it('T/a/x/1.txt'), it('T/a/1.txt')], { nest: false }).folders.map((f) => f.name), ['T / a', 'T / a / x', 'T / b']);
eq('two folders dropped together are two tops', topFolders(planImport([it('A/1.txt'), it('B/2.txt')])).map((f) => f.name), ['A', 'B']);
eq('an empty drop and a drop of only hidden files plan nothing', [planImport([]).folders.length, planImport([it('A/.DS_Store')]).count.folders], [0, 0]);
eq('a name is tidied and never empty', planImport([it('  Big   folder /x.txt'), it('///\\/y.txt')]).folders.map((f) => f.name), ['Big folder']);
eq('the limit is a number', MAX_IMPORT_FILES > 100, true);

eq('the next free ids', [nextIds([{ id: 3 }, { id: 9 }, { id: 4 }], 3), nextIds([], 2), nextIds([{ id: 1 }], 0)], [[10, 11, 12], [1, 2], []]);

// the action
const titleCol = { id: 'Name', kind: 'Text', isFormula: false };
const got = new Map();
nested.folders.forEach((f) => f.files.forEach((x, i) => got.set(x.item, 100 + f.index * 10 + i)));
const attId = (item) => got.get(item);
const acts = importActions('Sites', nested, attId, { ids: [20, 21, 22, 23], titleCol, filesCol: 'Files', parentCol: 'Parent', parentId: 7, prefill: { col: 'Project', value: 4 } });
eq('one BulkAddRecord with the new ids, names, files, parents and the link value', acts, [['BulkAddRecord', 'Sites', [20, 21, 22, 23], {
  Name: ['Customer', '2024', '2025', 'Q1'],
  Files: [['L', 100], ['L', 110, 111, 112], null, ['L', 130]],
  Parent: [7, 20, 20, 22],
  Project: [4, 4, 4, 4],
}]]);
eq('at the top level a folder has no parent (0); a failed upload is left out of the cell', (() => {
  const lost = importActions('Sites', nested, (x) => (x.path.endsWith('b.pdf') ? undefined : attId(x)), { ids: [1, 2, 3, 4], titleCol, filesCol: 'Files', parentCol: 'Parent' })[0][3];
  return [lost.Parent, lost.Files[1]];
})(), [[0, 1, 1, 3], ['L', 110, 111]]);
eq('without a Parent column nothing is written there', Object.keys(importActions('Sites', flat, attId, { ids: [1, 2, 3], titleCol, filesCol: 'Files' })[0][3]), ['Name', 'Files']);
eq('the link value never overwrites the name, the files or the parent', Object.keys(importActions('Sites', flat, attId, { ids: [1, 2, 3], titleCol, filesCol: 'Files', parentCol: 'Parent', prefill: { col: 'Name', value: 1 } })[0][3]), ['Name', 'Files', 'Parent']);
eq('no plan, no title column, or the wrong number of ids: nothing', [
  importActions('S', planImport([]), attId, { ids: [], titleCol, filesCol: 'F' }), importActions('S', nested, attId, { ids: [1, 2, 3, 4], filesCol: 'F' }), importActions('S', nested, attId, { ids: [1], titleCol, filesCol: 'F' }),
], [[], [], []]);

// reading entries
const fileE = (name, size = 1) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok({ name, size }) });
const badFile = (name) => ({ isFile: true, isDirectory: false, name, file: (ok, err) => err(new Error('gone')) });
const dirE = (name, kids, batch = 100) => ({ isFile: false, isDirectory: true, name, createReader() { let i = 0; return { readEntries(ok) { const b = kids.slice(i, i + batch); i += batch; ok(b); } }; } });

const many = Array.from({ length: 250 }, (_, i) => fileE(`f${i}.txt`));
const walked = await walkEntries([dirE('Top', [fileE('a.pdf'), dirE('Sub', [fileE('b.pdf'), dirE('.git', [fileE('config')]), fileE('.DS_Store')]), dirE('Many', many), badFile('broken.bin')])]);
eq('the walk gives every file with its path, in batches of 100; a hidden folder is not entered, only counted', [walked.items.length, walked.items.slice(0, 2).map((x) => x.path), walked.items.some((x) => /\.git/.test(x.path)), walked.skippedDirs], [253, ['Top/a.pdf', 'Top/Sub/b.pdf'], false, 1]);
eq('the hidden file the walk hands on is counted by the plan', planImport(walked.items.slice(0, 3), { nest: true }).count.skipped, 1);
eq('an unreadable file is counted, not fatal', [walked.unreadable, walked.tooMany], [1, false]);
const capped = await walkEntries([dirE('Top', many)], { limit: 100 });
eq('reading stops at the limit and says so', [capped.items.length, capped.tooMany], [100, true]);
eq('loose files dropped beside a folder keep a one-part path', (await walkEntries([fileE('x.txt'), dirE('A', [fileE('y.txt')])])).items.map((x) => x.path), ['x.txt', 'A/y.txt']);

// the drop itself
const dt = (items, files = []) => ({ files, items: items.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })) });
const none = droppedFiles(dt([fileE('a.jpg')], [{ name: 'a.jpg' }]));
const withDir = droppedFiles(dt([fileE('a.jpg'), dirE('A', [])], [{ name: 'a.jpg' }, { name: 'A' }]));
eq('a drop of files only is just the files, as before', [none.length, none.entries], [1, undefined]);
eq('a drop holding a folder carries its entries, and the list does not show them when spread', [withDir.length, withDir.entries.length, Object.keys(withDir), [...withDir].length], [2, 2, ['0', '1'], 2]);
eq('a browser without entries, and a text drop, give the plain list', [droppedFiles({ files: [{ name: 'a' }], items: [{ kind: 'file' }] }).length, droppedFiles({ files: [], items: [{ kind: 'string' }] }).length, droppedFiles(null).length], [1, 0, 0]);

// the picker
const picked = [{ name: 'a.pdf', webkitRelativePath: 'Top/a.pdf' }, { name: 'b.pdf', webkitRelativePath: 'Top/Sub/b.pdf' }];
eq('a directory picker list becomes paths; a plain picker has none', [listFromInput(picked).map((x) => x.path), hasFolders(picked), hasFolders([{ name: 'a.pdf', webkitRelativePath: '' }, { name: 'b' }])], [['Top/a.pdf', 'Top/Sub/b.pdf'], true, false]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
