// Justified rows, the card grid, virtual windows and arrow-key neighbours.

import { justify, grid, layoutFiles, layoutCards, visibleBlocks, locate, neighbour, aspectOf, clampAspect, HEAD_H } from '../src/model/layout.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const near = (a, b, e = 0.6) => Math.abs(a - b) <= e;
const ok = (n, cond) => eq(n, !!cond, true);

// ---- justify ----
const rows = justify([1.5, 1.5, 0.67, 1, 1.5, 1.5, 1.5], 600, { target: 180, gap: 6 });
ok('every full row is exactly as wide as the space', rows.slice(0, -1).every((r) => near(r.items.at(-1).x + r.items.at(-1).w, 600)));
ok('full rows end up near the target height', rows.slice(0, -1).every((r) => r.h > 120 && r.h < 260));
eq('the last row keeps the target height', rows.at(-1).h, 180);
eq('every tile is placed once, in order', rows.flatMap((r) => r.items.map((x) => x.i)), [0, 1, 2, 3, 4, 5, 6]);
ok('tiles keep their shapes', rows[0].items.every((it, k) => k === rows[0].items.length - 1 || near(it.w / rows[0].h, [1.5, 1.5, 0.67, 1][it.i], 0.01)));
ok('gaps between tiles', near(rows[0].items[1].x - (rows[0].items[0].x + rows[0].items[0].w), 6));
eq('one huge panorama is clamped', clampAspect(12), 3);
const tall = justify([0.4], 1000, { target: 200 });
eq('a lone tile is not stretched to the width', [tall.length, tall[0].h, tall[0].items[0].w], [1, 200, 80]);
eq('nothing to lay out', justify([], 500), []);

// ---- grid ----
const gr = grid(7, 600, { size: 180, gap: 6 });
eq('as many columns of at least the size as fit', [gr.cols, near(gr.cell, (600 - 12) / 3)], [3, true]);
eq('rows of the grid', gr.rows.map((r) => r.items.length), [3, 3, 1]);
eq('a space narrower than one tile still has one column', grid(2, 100, { size: 180 }).cols, 1);

// ---- aspect ----
eq('aspects', [
  aspectOf({ kind: 'image', w: 1200, h: 800 }),
  aspectOf({ kind: 'image', w: 0, h: 0 }),
  aspectOf({ kind: 'pdf' }),
  aspectOf({ kind: 'video' }) > 1.7,
  aspectOf({ kind: 'image', w: 1800, h: 1200, ident: 'x' }, new Map([['x', 2 / 3]])),
], [1.5, 1, 0.72, true, 2 / 3]);

// ---- the Files layout ----
const F = (key, w = 1200, h = 800) => ({ key, kind: 'image', w, h, ident: key });
const groups = [
  { rec: { rowId: 1 }, files: [F('a'), F('b'), F('c', 800, 1200)] },
  { rec: { rowId: 2 }, files: [F('d'), F('e')] },
];
const L = layoutFiles(groups, { width: 624, size: 180, gap: 6, pad: 12 });
eq('a header before each record', L.blocks.filter((b) => b.kind === 'head').map((b) => [b.g, b.h]), [[0, HEAD_H], [1, HEAD_H]]);
ok('blocks go down the page without overlapping', L.blocks.every((b, i) => i === 0 || b.y >= L.blocks[i - 1].y + L.blocks[i - 1].h));
ok('the height covers the last block', L.height >= L.blocks.at(-1).y + L.blocks.at(-1).h);
ok('tiles start at the padding', L.blocks.filter((b) => b.kind === 'row').every((b) => near(b.tiles[0].x, 12)));
const flat = layoutFiles([{ rec: null, files: groups.flatMap((x) => x.files) }], { width: 624, grouped: false });
eq('ungrouped has no headers', flat.blocks.every((b) => b.kind === 'row'), true);
const capt = layoutFiles(groups, { width: 624, captions: true });
ok('captions make rows taller than their pictures', capt.blocks.filter((b) => b.kind === 'row').every((b) => near(b.h, b.tiles[0].h + 22)));
const sq = layoutFiles(groups, { width: 624, fit: 'square', size: 180 });
ok('square tiles are square', sq.blocks.filter((b) => b.kind === 'row').every((b) => b.tiles.every((t) => near(t.w, t.h))));

// ---- windows ----
const many = layoutFiles([{ rec: null, files: Array.from({ length: 3000 }, (_, i) => F('k' + i)) }], { width: 1000, grouped: false });
const win = visibleBlocks(many.blocks, 20000, 20800);
ok('only the rows in sight', win.length > 0 && win.length < 10);
ok('the window overlaps the range', win[0].y <= 20800 && win.at(-1).y + win.at(-1).h >= 20000);
eq('nothing past the end', visibleBlocks(many.blocks, many.height + 10, many.height + 500), []);

// ---- cards ----
const LC = layoutCards(10, { width: 800, size: 240, gap: 14, pad: 14, fields: 2 });
eq('card columns', LC.cols, 3);
eq('cards per row', LC.blocks.map((b) => b.cards.length), [3, 3, 3, 1]);
ok('cover is 4:3', near(LC.coverH, LC.cardW * 0.75, 1));
ok('more fields make a taller body', layoutCards(3, { width: 800, fields: 4 }).bodyH > LC.bodyH);

// ---- keys ----
eq('locate a tile', locate(L.blocks, 'c') && locate(L.blocks, 'c').tile.f.key, 'c');
eq('right goes on in reading order, across records', [neighbour(L.blocks, 'a', 'right'), neighbour(L.blocks, 'c', 'right')], ['b', 'd']);
eq('left from the first file stays put', neighbour(L.blocks, 'a', 'left'), null);
const below = neighbour(L.blocks, 'a', 'down');
ok('down goes to the row below', below && below !== 'a');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
