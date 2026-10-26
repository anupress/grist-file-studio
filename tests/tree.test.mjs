// Folders inside folders: building the tree from records and a parent, the questions it answers, and the rows the list shows.

import { visibleFiles, visibleRecords } from '../src/model/files.js';
import { refId, buildTree, subtreeIds, ancestorIds, canMoveTo, visibleRows, moveFolderActions, belowOf } from '../src/model/tree.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const rec = (rowId, title, files = 0) => ({ rowId, title, files: Array.from({ length: files }, (_, i) => ({ key: rowId + ':' + i })) });
eq('a reference cell: encoded, plain, empty, nonsense', [refId(['R', 'Sites', 7]), refId(7), refId(0), refId(null), refId(['L', 1]), refId(['R', 'Sites', 0]), refId('x')], [7, 7, 0, 0, 0, 0, 0]);

// Austria > Vienna (2 files), Germany > Hamburg (6), Berlin (0); France > Lyon (4) > Old town (1); Spare (3)
const records = [rec(1, 'Austria'), rec(2, 'Vienna', 2), rec(3, 'Germany'), rec(4, 'Hamburg', 6), rec(5, 'Berlin'), rec(6, 'France'), rec(7, 'Lyon', 4), rec(8, 'Old town', 1), rec(9, 'Spare', 3)];
const parents = { 2: 1, 4: 3, 5: 3, 7: 6, 8: 7 };
const tree = buildTree(records, (id) => parents[id] || 0);
const shape = (n) => `${n.title}${n.children.length ? '(' + n.children.map(shape).join(',') + ')' : ''}`;
eq('the tree, each level by name', tree.roots.map(shape), ['Austria(Vienna)', 'France(Lyon(Old town))', 'Germany(Berlin,Hamburg)', 'Spare']);
eq('files in a folder and in it with everything below', ['France', 'Lyon', 'Old town', 'Germany', 'Spare'].map((t) => { const n = [...tree.nodes.values()].find((x) => x.title === t); return [n.own, n.total]; }), [[0, 5], [4, 5], [1, 1], [0, 6], [3, 3]]);
const cover = (id) => (id === 4 ? { key: 'hamburg-cover' } : id === 2 ? { key: 'vienna-cover' } : null);
eq('a folder with only folders below it: the first cover found, the files and the folders below', [belowOf(tree.nodes.get(3), cover), belowOf(tree.nodes.get(6), (id) => (id === 8 ? { key: 'old' } : id === 7 ? { key: 'lyon' } : null)), belowOf(tree.nodes.get(1), cover)], [
  { files: 6, folders: 2, cover: { key: 'hamburg-cover' } }, { files: 5, folders: 2, cover: { key: 'lyon' } }, { files: 2, folders: 1, cover: { key: 'vienna-cover' } }]);
eq('no card cover below a folder that has files itself, a folder without folders, or nothing', [belowOf(tree.nodes.get(7), cover), belowOf(tree.nodes.get(4), cover), belowOf(tree.nodes.get(5), cover), belowOf(null, cover)], [null, null, null, null]);
eq('only empty folders below: nothing to show', belowOf(buildTree([rec(1, 'A'), rec(2, 'B')], (id) => (id === 2 ? 1 : 0)).nodes.get(1), cover), null);
eq('depth', [8, 7, 6].map((id) => tree.nodes.get(id).depth), [2, 1, 0]);
eq('a folder and what is below it', [...subtreeIds(tree, 6)].sort(), [6, 7, 8]);
eq('an unknown folder has nothing below it', subtreeIds(tree, 99).size, 0);
eq('the way down to a folder', [ancestorIds(tree, 8), ancestorIds(tree, 6), ancestorIds(tree, 99)], [[6, 7], [], []]);

eq('moves: under another, to the top, not under itself or below itself, not to nowhere', [canMoveTo(tree, 7, 3), canMoveTo(tree, 7, 0), canMoveTo(tree, 6, 8), canMoveTo(tree, 6, 6), canMoveTo(tree, 7, 99), canMoveTo(tree, 99, 1)], [true, true, false, false, false, false]);

// trouble in the column
const odd = buildTree([rec(1, 'A'), rec(2, 'B'), rec(3, 'C'), rec(4, 'D'), rec(5, 'E')], (id) => ({ 1: 2, 2: 1, 3: 3, 4: 99, 5: 4 }[id] || 0));
eq('a loop, a folder under itself and a missing parent: the loop is cut at its first folder, the others go to the top', odd.roots.map(shape), ['A(B)', 'C', 'D(E)']);
const everyOnce = (t) => { const seen = []; const walk = (n) => { seen.push(n.rowId); n.children.forEach(walk); }; t.roots.forEach(walk); return seen.sort((a, b) => a - b); };
eq('every folder appears exactly once, whatever the column says', everyOnce(odd), [1, 2, 3, 4, 5]);
eq('no parent function at all: a flat list', buildTree(records, () => 0).roots.length, 9);
eq('untitled folders sort after their equals by id and do not break', buildTree([rec(3, ''), rec(1, ''), rec(2, 'B')], () => 0).roots.map((n) => n.rowId), [1, 3, 2]);

// the list
const ids = (rows) => rows.map((r) => r.node.title + (r.hasChildren ? (r.open ? '-' : '+') : ''));
eq('closed: the top level', ids(visibleRows(tree, new Set())), ['Austria+', 'France+', 'Germany+', 'Spare']);
eq('one open', ids(visibleRows(tree, new Set([6]))), ['Austria+', 'France-', 'Lyon+', 'Germany+', 'Spare']);
eq('open down to a leaf, with depth', visibleRows(tree, new Set([6, 7])).map((r) => `${r.node.title}:${r.depth}`), ['Austria:0', 'France:0', 'Lyon:1', 'Old town:2', 'Germany:0', 'Spare:0']);
eq('a search keeps the matches and the way to them, all open', ids(visibleRows(tree, new Set(), new Set([8, 5]))), ['France-', 'Lyon-', 'Old town', 'Germany-', 'Berlin']);
eq('a search with nothing found shows nothing', visibleRows(tree, new Set(), new Set()).length, 0);
eq('the move is one update, 0 for the top', [moveFolderActions('Sites', 7, 'Parent', 3), moveFolderActions('Sites', 7, 'Parent', 0)], [[['UpdateRecord', 'Sites', 7, { Parent: 3 }]], [['UpdateRecord', 'Sites', 7, { Parent: 0 }]]]);

// a chosen folder: its files and those below it, the folder first and then its folders in order
const gal = { records: records.map((r) => ({ ...r, fields: [], files: r.files.map((f) => ({ ...f, name: f.key, group: 'image', ext: 'jpg', size: 1, tags: [], notesText: '' })) })) };
const scope = subtreeIds(tree, 6);
eq('a scope shows its folders, the chosen one first, and only those with files unless asked', visibleFiles(gal, { scope }).groups.map((g) => g.rec.title), ['Lyon', 'Old town']);
eq('...empty folders too when asked, in tree order', visibleFiles(gal, { scope, empty: scope }).groups.map((g) => g.rec.title), ['France', 'Lyon', 'Old town']);
eq('the cards of a scope', visibleRecords(gal, { scope }).map((r) => r.title), ['France', 'Lyon', 'Old town']);
eq('no scope: every record, in table order', visibleRecords(gal, {}).length, 9);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
