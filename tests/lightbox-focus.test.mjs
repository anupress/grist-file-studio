// A click on a filmstrip thumbnail of the lightbox shows another file and builds the strip again, so the button that was clicked is removed and the keyboard focus
// drops to the page: the arrows, S, I, E and Esc then do nothing (seen while filming the slideshow). go() must give the focus back to the box.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'views', 'lightbox.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`  FAIL ${n} ${d}`); } };

const start = src.indexOf('function go(k)');
const end = src.indexOf('function close()', start);
const body = start >= 0 && end > start ? src.slice(start, end) : '';
ok('go() is found', body.length > 0);
ok('go() shows the file before it looks at the focus', body.indexOf('show()') >= 0 && body.indexOf('show()') < body.indexOf('focus'));
ok('go() takes the focus back when it is no longer inside the box', /if \(!box\.contains\(box\.ownerDocument\.activeElement\)\) box\.focus\(/.test(body));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
