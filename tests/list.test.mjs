// The list layout (a Details view): one row per file, the columns that fit, and the sorts a column heading switches between.

import { layoutFiles, listColumns, ROW_H, HEAD_H } from '../src/model/layout.js';
import { sortFiles, listSortFor, listSortState, LIST_SORTS, SORTS } from '../src/model/files.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const f = (key, name, ext, size, uploaded) => ({ key, name, ext, size, uploaded, w: 100, h: 100 });
const groups = [
  { rec: { rowId: 1 }, files: [f('a', 'b.jpg', 'jpg', 300, 3), f('b', 'a.pdf', 'pdf', 100, 1), f('c', 'c.txt', 'txt', 200, 2)] },
  { rec: { rowId: 2 }, files: [f('d', 'd.jpg', 'jpg', 50, 4)] },
];
const lay = layoutFiles(groups, { width: 800, fit: 'list' });
const rows = lay.blocks.filter((b) => b.kind === 'row');
eq('one row per file, one tile in each', rows.map((b) => b.tiles.length), [1, 1, 1, 1]);
eq('every row is ROW_H high and as wide as the wall inside its padding', [...new Set(rows.map((b) => b.h))].concat([...new Set(rows.map((b) => b.tiles[0].w))]), [ROW_H, 776]);
eq('rows follow each other without a gap inside a record', [rows[1].y - rows[0].y, rows[2].y - rows[1].y], [ROW_H, ROW_H]);
eq('the next record starts after its heading and a gap', [lay.blocks.find((b) => b.kind === 'head' && b.g === 1).y - (rows[2].y + ROW_H), rows[3].y - lay.blocks.find((b) => b.kind === 'head' && b.g === 1).y], [10, HEAD_H]);
eq('the height holds every row', lay.height >= rows[3].y + ROW_H, true);
const flat = layoutFiles([{ rec: null, files: groups[0].files.concat(groups[1].files) }], { width: 800, fit: 'list', grouped: false });
eq('not grouped: no headings, rows one after the other', [flat.blocks.every((b) => b.kind === 'row'), flat.blocks.length, flat.blocks[3].y - flat.blocks[0].y], [true, 4, 3 * ROW_H]);

eq('columns by width: name only on a phone', listColumns(390).map((c) => c.id), ['name']);
eq('size comes first, then type, then the date', [listColumns(500).map((c) => c.id), listColumns(700).map((c) => c.id), listColumns(800).map((c) => c.id)], [['name', 'size'], ['name', 'type', 'size'], ['name', 'type', 'size', 'added']]);
eq('tags need room, the record column only without headings and on a wide wall', [listColumns(1000, { tags: true }).map((c) => c.id), listColumns(1000, { folder: true }).map((c) => c.id), listColumns(900, { folder: true }).map((c) => c.id)], [['name', 'type', 'size', 'added', 'tags'], ['name', 'folder', 'type', 'size', 'added'], ['name', 'type', 'size', 'added']]);
eq('the name has no fixed width, the others do', listColumns(1200, { tags: true }).map((c) => c.w), [null, 64, 76, 116, 180]);

eq('click a heading: the first sort, then its opposite, then the first again', [listSortFor('name', 'cell'), listSortFor('name', 'name'), listSortFor('name', 'name-desc'), listSortFor('size', 'name'), listSortFor('size', 'largest'), listSortFor('added', 'newest'), listSortFor('added', 'oldest')], ['name', 'name-desc', 'name', 'largest', 'smallest', 'oldest', 'newest']);
eq('an unknown column changes nothing', listSortFor('tags', 'name'), 'name');
eq('what a heading says (aria-sort)', [listSortState('name', 'name'), listSortState('name', 'name-desc'), listSortState('size', 'largest'), listSortState('size', 'smallest'), listSortState('type', 'name'), listSortState('added', 'newest')], ['ascending', 'descending', 'descending', 'ascending', 'none', 'descending']);
eq('every sort a heading uses is a known sort', Object.values(LIST_SORTS).flat().map(([id]) => id).every((id) => SORTS.includes(id)), true);

const all = groups[0].files.concat(groups[1].files);
const keys = (sort) => sortFiles(all, sort).map((x) => x.key).join('');
eq('sorts: name both ways, size both ways, type both ways', [keys('name'), keys('name-desc'), keys('largest'), keys('smallest'), keys('type'), keys('type-desc')], ['bacd', 'dcab', 'acbd', 'dbca', 'adbc', 'cbad']);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
