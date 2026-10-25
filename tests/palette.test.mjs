// The command palette's choosing and ordering: what fits a query, and in which group and order it shows.

import { rankPalette, fitOf, PALETTE_LIMITS } from '../src/model/palette.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const c = (label, extra = {}) => ({ group: 'commands', label, ...extra });
const d = (label, hint = '') => ({ group: 'folders', label, hint });
const f = (label, hint = '', words = '') => ({ group: 'files', label, hint, words });
const items = [
  c('Add files…'), c('New folder…'), c('Layout: Cards'), c('Sort: Largest first'), c('Sort: Name'), c('Storage…'), c('Show as: List'),
  d('Testgasse 7, Vienna', '9 files'), d('Hafenstraße 12, Hamburg', '6 files'), d('Kitchen studio', '2 files'),
  f('kitchen.jpg', 'Testgasse 7, Vienna · 79 kB', 'kitchen before'), f('damp-corner.jpg', 'Testgasse 7, Vienna · 86 kB'), f('Floor plan.pdf', 'Hafenstraße 12, Hamburg · 27 kB'),
];
const labels = (q) => rankPalette(items, q).map((g) => [g.group, g.items.map((x) => x.label)]);

eq('fit: starts with, every word starts a word, inside, only in the extra text, no', [
  fitOf(c('Sort: Largest first'), ['sort']), fitOf(c('Sort: Largest first'), ['larg']), fitOf(c('Sort: Largest first'), ['first', 'sort']), fitOf(c('Sort: Largest first'), ['argest']),
  fitOf(f('a.jpg', 'Hafen', 'balcony'), ['balcony']), fitOf(c('Storage…'), ['zzz']),
], [0, 1, 1, 2, 3, null]);
eq('nothing typed: the first commands only', rankPalette(items, '').map((g) => g.group), ['commands']);
eq('nothing typed: no more than the limit', rankPalette(Array.from({ length: 30 }, (_, i) => c('Command ' + i)), '')[0].items.length, PALETTE_LIMITS.commands);
eq('a command by a part of its name, a folder and a file in their own groups', labels('kitchen'), [['folders', ['Kitchen studio']], ['files', ['kitchen.jpg']]].sort((a, b) => 0));
eq('accents and capitals do not matter', labels('hafenstrasse').map((g) => g[0]), ['folders', 'files']);
eq('words in any order; a file is found by its record', labels('vienna testgasse').map(([g, l]) => [g, l]), [['folders', ['Testgasse 7, Vienna']], ['files', ['kitchen.jpg', 'damp-corner.jpg']]]);
eq('a file is found by its note words', labels('before').map(([g, l]) => [g, l]), [['files', ['kitchen.jpg']]]);
eq('the group with the best match comes first', labels('sort').map((g) => g[0])[0], 'commands');
eq('commands: best fit first, then the order given', labels('sort')[0][1], ['Sort: Largest first', 'Sort: Name']);
eq('no match: nothing', rankPalette(items, 'qqqq'), []);
eq('a group is cut to its limit', rankPalette(Array.from({ length: 20 }, (_, i) => f('photo ' + i)), 'photo')[0].items.length, PALETTE_LIMITS.files);
eq('an unknown group is left out', rankPalette([{ group: 'other', label: 'x' }], 'x'), []);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
