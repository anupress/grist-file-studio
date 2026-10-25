// Lists every interface string the code passes through t() / tn(), and which ones the German or the
// French table lacks, and any translation that lost or renamed a {placeholder}. Run after adding
// interface text:  node scripts/ui-strings.mjs   (exit 1 when anything is missing)
import fs from 'node:fs';
import path from 'node:path';
import { DE } from '../src/i18n/de.js';
import { FR } from '../src/i18n/fr.js';

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (!/^(core|i18n|model|demo|data|media)$/.test(f)) walk(p); } else if (p.endsWith('.js')) files.push(p);
  }
})('src');

const Q = "'((?:[^'\\\\]|\\\\.)*)'";   // a single-quoted JS string, escapes allowed
const set = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(new RegExp('\\bt\\(\\s*' + Q, 'g'))) set.add(m[1]);
  for (const m of s.matchAll(new RegExp('\\btn\\([^,]+,\\s*' + Q + ',\\s*' + Q, 'g'))) { set.add(m[1]); set.add(m[2]); }
  // tables of strings that reach t() through a variable: ['Label', 'Hint'] pairs and *_LABELS objects
  // (identifiers and class names in such pairs are code, not text: 'parent', ' is-late', 'ps-head')
  const textual = (x) => x && !/^\s/.test(x) && !/^[a-z][\w-]*$/.test(x) && !/^#[0-9a-f]{3,8}$/i.test(x);   // ids, class names and colours are code
  for (const m of s.matchAll(new RegExp('\\[' + Q + ',\\s*(?:' + Q + '|null)\\]', 'g'))) { if (textual(m[1])) set.add(m[1]); if (textual(m[2])) set.add(m[2]); }
  // objects of interface text: const LAYOUT_LABELS = {...}, GROUP_LABELS, SORT_LABELS
  for (const block of s.matchAll(/const [A-Z_]+_(?:LABELS|MESSAGES) = \{([\s\S]*?)\};/g)) {
    for (const m of block[1].matchAll(new RegExp(':\\s*' + Q, 'g'))) set.add(m[1]);
  }
}
const unescape = (k) => k.replace(/\\'/g, "'");
const all = [...set].map(unescape).sort();
let bad = 0;
for (const [name, table] of [['German', DE], ['French', FR]]) {
  const missing = all.filter((k) => !(k in table));
  console.log(`${all.length} strings, ${missing.length} without ${name}`);
  for (const k of missing) console.log('  ' + JSON.stringify(k));
  bad += missing.length;
}
// A placeholder lost in translation shows {n} to someone, or drops the number.
for (const [name, table] of [['German', DE], ['French', FR]]) {
  for (const k of all) {
    const want = (k.match(/\{\w+\}/g) || []).sort().join();
    const got = ((table[k] || k).match(/\{\w+\}/g) || []).sort().join();
    if (want !== got) { console.log(`  ${name} placeholders differ: ${JSON.stringify(k)}`); bad++; }
  }
}
process.exitCode = bad ? 1 : 0;
