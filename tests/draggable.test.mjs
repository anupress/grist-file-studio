// A picture that the browser can drag natively is dropped on the widget as a new file (seen in real Grist: dragging a thumbnail of the filmstrip
// sometimes added a copy of it to the record). el() (src/core/util.js) leaves out a property whose value is false, so `el('img', { draggable: false })`
// does nothing and the picture stays draggable. This test keeps that spelling out of the code: set `node.draggable = false` after el() instead.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`  FAIL ${n} ${d}`); } };

const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
const files = walk(ROOT);
const bad = [];
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (/draggable\s*:\s*false/.test(line)) bad.push(`${f.slice(ROOT.length + 1)}:${i + 1}`); });
}
ok('no el() call passes draggable: false (it is ignored; set node.draggable = false)', bad.length === 0, bad.join(', '));
ok('the source was scanned', files.length > 40, String(files.length));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
