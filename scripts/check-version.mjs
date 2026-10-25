// The version is written in four places, and a release that bumps three of them ships a widget whose
// badge, cache-busting ?v= and changelog disagree. This fails when any of them differs:
//   package.json, package-lock.json, src/version.js, and the newest "## x.y.z" heading of CHANGELOG.md.
//   node scripts/check-version.mjs   (exit 1 on a mismatch)
import fs from 'node:fs';

const read = (f) => fs.readFileSync(f, 'utf8');
const found = {
  'package.json': JSON.parse(read('package.json')).version,
  'package-lock.json': JSON.parse(read('package-lock.json')).version,
  'src/version.js': (read('src/version.js').match(/VERSION\s*=\s*'([^']+)'/) || [])[1],
  'CHANGELOG.md': (read('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+)/m) || [])[1],
};
const want = found['package.json'];
const wrong = Object.entries(found).filter(([, v]) => v !== want);
if (wrong.length) {
  for (const [f, v] of wrong) console.error(`${f}: ${v ?? 'no version found'}, package.json says ${want}`);
  process.exit(1);
}
console.log('version', want, 'everywhere');
