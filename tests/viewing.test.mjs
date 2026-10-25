// The slideshow's timing and the before/after slider's keys.

import { SPEEDS, DEFAULT_SPEED, speedFrom, dwell, nextIndex, nearestImage, stepDivider, dividerAt } from '../src/model/viewing.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

eq('speeds', [SPEEDS, DEFAULT_SPEED], [[3, 5, 8], 5]);
eq('a kept speed is used only when it is one of the choices', [speedFrom('8'), speedFrom(8), speedFrom('7'), speedFrom(null), speedFrom('abc')], [8, 8, 5, 5, 5]);
eq('a picture stays as long as chosen, a document twice, video and audio until they end', [dwell('image', 5), dwell('heic', 3), dwell('pdf', 5), dwell('text', 3), dwell('other', 8), dwell('video', 5), dwell('audio', 5)], [5, 3, 10, 6, 16, null, null]);
eq('the next file comes round to the first', [nextIndex(0, 3), nextIndex(2, 3), nextIndex(0, 1), nextIndex(0, 0)], [1, 0, 0, 0]);
const list = [{ kind: 'pdf' }, { kind: 'image' }, { kind: 'text' }, { kind: 'image' }, { kind: 'video' }];
eq('the nearest picture forward and back, and none', [nearestImage(list, 1, 1), nearestImage(list, 3, -1), nearestImage(list, 3, 1), nearestImage(list, 1, -1), nearestImage(list, 0, -1)], [3, 1, -1, -1, -1]);
eq('divider keys: arrows by 2, Shift by 10, Page keys by 10, Home and End', [stepDivider(50, 'ArrowLeft'), stepDivider(50, 'ArrowRight', true), stepDivider(50, 'PageDown'), stepDivider(50, 'Home'), stepDivider(50, 'End')], [48, 60, 40, 0, 100]);
eq('the divider stays between 0 and 100 and ignores other keys', [stepDivider(1, 'ArrowLeft'), stepDivider(99, 'ArrowRight'), stepDivider(50, 'a')], [0, 100, null]);
eq('the divider under the pointer', [dividerAt(150, 50, 200), dividerAt(10, 50, 200), dividerAt(900, 50, 200), dividerAt(5, 0, 0)], [50, 0, 100, 50]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
