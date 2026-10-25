// Builds vendor/pdflib/pdflib.mjs from scripts/pdflib-entry.js: pdf-lib for the PDF tools (merge, split,
// reorder, rotate, fill and sign, page numbers), loaded only when a PDF is opened for editing.
//   node scripts/build-pdflib.mjs
// The output is committed, like pdf.js and the text editor, so neither development nor the deploy needs
// this step. Every package in the bundle is listed in its banner and its own licence text is copied to
// vendor/pdflib/LICENSES.txt. A licence outside ALLOWED stops the build until someone has read it.
import { build } from 'esbuild';
import fs from 'node:fs';

const OUT = 'vendor/pdflib/pdflib.mjs';
const LICENSES = 'vendor/pdflib/LICENSES.txt';
const ALLOWED = new Set(['MIT', '(MIT AND Zlib)', '0BSD', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0']);
fs.mkdirSync('vendor/pdflib', { recursive: true });
const result = await build({
  entryPoints: ['scripts/pdflib-entry.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  legalComments: 'none',
  target: ['es2020'],
  outfile: OUT,
  metafile: true,
});
const bundled = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.split('\\').join('/'));
  if (m) bundled.add(m[1]);
}
const pkgs = [...bundled].sort().map((name) => {
  const dir = `node_modules/${name}`;
  const json = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8'));
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
  return { name, version: json.version, license: json.license, text: file ? fs.readFileSync(`${dir}/${file}`, 'utf8').trim() : null };
});
const bad = pkgs.filter((p) => !p.text || !ALLOWED.has(p.license));
if (bad.length) throw new Error('read these licences by hand: ' + bad.map((p) => `${p.name} (${p.license}, ${p.text ? 'has' : 'no'} LICENSE file)`).join(', '));
const banner = `/* File Studio PDF library, bundled by scripts/build-pdflib.mjs. Licences are in LICENSES.txt next to this file.\n${pkgs.map((p) => ` * ${p.name} ${p.version} (${p.license})`).join('\n')}\n */\n`;
fs.writeFileSync(OUT, banner + fs.readFileSync(OUT, 'utf8'));
fs.writeFileSync(LICENSES, pkgs.map((p) => `${p.name} ${p.version} (${p.license})\n${'='.repeat(p.name.length + p.version.length + p.license.length + 4)}\n\n${p.text}\n`).join('\n\n'));
console.log('built', OUT, Math.round(fs.statSync(OUT).size / 1024), 'kB;', pkgs.length, 'packages:', pkgs.map((p) => `${p.name}@${p.version}`).join(' '));
