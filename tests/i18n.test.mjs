// The interface language: every string has German and French with its placeholders, and the
// automatic choice follows Grist first, then the browser.

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.location = { search: '' };
const I = await import(pathToFileURL(resolve(ROOT, 'src/i18n/index.js')).href);

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const check = spawnSync(process.execPath, ['scripts/ui-strings.mjs'], { cwd: ROOT, encoding: 'utf8' });
eq('every interface string has German and French, placeholders intact (node scripts/ui-strings.mjs)', check.status, 0);
if (check.status) console.log(check.stdout);

eq('automatic follows Grist first', I.resolveLanguage('auto', 'de-DE', 'en-GB'), 'de');
eq('then the browser', I.resolveLanguage('auto', '', 'fr-CA'), 'fr');
eq('anything else is English', I.resolveLanguage('auto', 'es-ES', 'es-ES'), 'en');
eq('a choice wins', I.resolveLanguage('en', 'de-DE', 'de-DE'), 'en');

I.setLanguage('de', { remember: false });
eq('German text', I.t('Add files'), 'Dateien hinzufügen');
eq('German plural', [I.tn(1, '{n} file', '{n} files'), I.tn(3, '{n} file', '{n} files')], ['1 Datei', '3 Dateien']);
I.setLanguage('fr', { remember: false });
eq('French typography: a no-break space before a colon', I.t('For example: {path}', { path: 'x' }), 'Par exemple : x');
eq('French quotes', I.t('Renamed to “{name}”.', { name: 'a.jpg' }), 'Renommé en « a.jpg ».');
I.setLanguage('en', { remember: false });
eq('English is the key', I.t('Add files'), 'Add files');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
