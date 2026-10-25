// Builds vendor/codemirror/editor.mjs from scripts/editor-entry.js: CodeMirror 6 with the languages
// File Studio edits, plus marked for the Markdown preview. Run after changing a version:
//   node scripts/build-editor.mjs
// The output is committed, like pdf.js, so neither development nor the deploy needs this step.
// Every package that ends up in the bundle (the direct ones and what they pull in) is listed in the
// banner, and its own LICENSE text is copied to vendor/codemirror/LICENSES.txt.
import { build } from 'esbuild';
import fs from 'node:fs';

const OUT = 'vendor/codemirror/editor.mjs';
const LICENSES = 'vendor/codemirror/LICENSES.txt';
const result = await build({
  entryPoints: ['scripts/editor-entry.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  legalComments: 'none',
  target: ['es2020'],
  outfile: OUT,
  metafile: true,
});
// node_modules/@scope/name/... or node_modules/name/... -> the package name
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
const missing = pkgs.filter((p) => !p.text || p.license !== 'MIT');
if (missing.length) throw new Error('check these licences by hand: ' + missing.map((p) => `${p.name} (${p.license}, ${p.text ? 'has' : 'no'} LICENSE file)`).join(', '));
const banner = `/* File Studio text editor libraries, bundled by scripts/build-editor.mjs. All MIT licensed;\n * their licence texts are in LICENSES.txt next to this file.\n${pkgs.map((p) => ` * ${p.name} ${p.version}`).join('\n')}\n */\n`;
fs.writeFileSync(OUT, banner + fs.readFileSync(OUT, 'utf8'));
fs.writeFileSync(LICENSES, pkgs.map((p) => `${p.name} ${p.version}\n${'='.repeat(p.name.length + p.version.length + 1)}\n\n${p.text}\n`).join('\n\n'));
console.log('built', OUT, Math.round(fs.statSync(OUT).size / 1024), 'kB;', pkgs.length, 'packages:', pkgs.map((p) => `${p.name}@${p.version}`).join(' '));
