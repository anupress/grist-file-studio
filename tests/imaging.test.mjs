// The picture editor's arithmetic: identity, tone direction, colour, auto levels, sharpening,
// pixelation, straightening and crop geometry.

import { toneLuts, applyAdjust, isIdentity, autoLevels, sharpen, pixelate, straightenScale, cropToAspect, dragCrop, resizeTo, outputFormat, turnedSize, ADJUST_DEFAULTS, LOOKS } from '../src/media/imaging.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const ok = (n, c) => eq(n, !!c, true);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const img = (w, h, f) => { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const [r, g, b] = f(i); data.set([r, g, b, 255], i * 4); } return { width: w, height: h, data }; };
const px = (im, i) => [...im.data.slice(i * 4, i * 4 + 4)];

// ---- tone ----
const id = toneLuts({ ...ADJUST_DEFAULTS });
ok('every value at 0 changes nothing', id.every((l) => l.every((v, i) => v === i)));
ok('identity is detected', isIdentity({ ...ADJUST_DEFAULTS }) && !isIdentity({ ...ADJUST_DEFAULTS, warmth: 5 }));
const bright = toneLuts({ ...ADJUST_DEFAULTS, exposure: 1 });
eq('one stop up doubles the mid tones, clamps the top', [bright[0][60], bright[0][200]], [120, 255]);
const contrast = toneLuts({ ...ADJUST_DEFAULTS, contrast: 50 });
ok('contrast darkens darks and brightens lights, keeps the middle', contrast[0][64] < 64 && contrast[0][192] > 192 && Math.abs(contrast[0][128] - 128) <= 1);
const shadows = toneLuts({ ...ADJUST_DEFAULTS, shadows: 60 });
ok('shadows lift the darks more than the lights, black stays black', shadows[0][50] - 50 > shadows[0][200] - 200 && shadows[0][0] === 0 && shadows[0][255] === 255);
const highlights = toneLuts({ ...ADJUST_DEFAULTS, highlights: -60 });
ok('highlights pull back the brights, white stays white', highlights[0][210] < 210 && highlights[0][40] >= 39 && highlights[0][255] === 255);
const levels = toneLuts({ ...ADJUST_DEFAULTS, levels: [[20, 220], [0, 255], [0, 255]] });
eq('levels stretch a channel', [levels[0][20], levels[0][220], levels[0][120], levels[1][120]], [0, 255, 128, 120]);

// ---- colour ----
const grey = img(1, 1, () => [120, 120, 120]);
eq('saturation leaves grey grey', px(applyAdjust(grey, { ...ADJUST_DEFAULTS, saturation: 80 }), 0), [120, 120, 120, 255]);
const red = img(1, 1, () => [200, 80, 80]);
const bw = px(applyAdjust(red, { ...ADJUST_DEFAULTS, saturation: -100 }), 0);
ok('saturation -100 is black and white', bw[0] === bw[1] && bw[1] === bw[2]);
const warm = px(applyAdjust(img(1, 1, () => [100, 100, 100]), { ...ADJUST_DEFAULTS, warmth: 50 }), 0);
ok('warmth adds red and takes blue', warm[0] > 100 && warm[2] < 100);
const untouched = img(2, 2, (i) => [i * 10, 50, 200]);
const before = [...untouched.data];
applyAdjust(untouched, { ...ADJUST_DEFAULTS });
eq('the identity pass leaves bytes alone', [...untouched.data], before);

// ---- auto ----
const dull = img(100, 1, (i) => [60 + i, 70 + i, 50 + i]);   // a narrow, yellowish range
const lv = autoLevels(dull);
ok('auto finds each channel’s range', lv && lv[0][0] >= 60 && lv[0][1] <= 160 && lv[2][0] >= 50);
const full = img(256, 1, (i) => [i, i, i]);
eq('a picture that spans the range needs no levels', autoLevels(full), null);

// ---- sharpen, pixelate ----
const edge = img(5, 5, (i) => (i % 5 < 2 ? [100, 100, 100] : [150, 150, 150]));
sharpen(edge, 100);
ok('sharpening pushes the two sides of an edge apart', px(edge, 11)[0] < 100 && px(edge, 12)[0] > 150);
const block = img(4, 4, (i) => [i * 16, 0, 0]);
pixelate(block, { x: 0, y: 0, w: 4, h: 4 }, 4);
ok('pixelate gives a block one colour', new Set(Array.from({ length: 16 }, (_, i) => px(block, i)[0])).size === 1);

// ---- geometry ----
eq('quarter turns swap the sides', [turnedSize(400, 300, 90), turnedSize(400, 300, 180)], [[300, 400], [400, 300]]);
eq('no straightening, no scale', straightenScale(400, 300, 0), 1);
ok('straightening grows the picture to keep the corners filled', straightenScale(400, 300, 10) > 1.2 && straightenScale(400, 300, 10) < 1.4);
const sq = cropToAspect({ x: 0, y: 0, w: 1, h: 1 }, 1, 400, 300);
ok('a square crop of a landscape is as tall as the picture and centred', near(sq.h, 1) && near(sq.w, 0.75) && near(sq.x, 0.125));
const wide = cropToAspect({ x: 0, y: 0, w: 1, h: 1 }, 16 / 9, 400, 300);
ok('16:9 of 4:3 is as wide as the picture', near(wide.w, 1) && near(wide.h * 300 / (wide.w * 400), 9 / 16, 1e-9));
const moved = dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'move', 0.6, -0.5);
eq('a moved crop stays inside', moved, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
const grown = dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'se', 0.2, 0.1);
ok('a corner drag resizes', near(grown.w, 0.7) && near(grown.h, 0.6));
const kept = dragCrop({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, 'se', 0.2, 0, { aspect: 1, picW: 400, picH: 300 });
ok('a corner drag keeps the shape', near(kept.w * 400, kept.h * 300, 1e-6));
const tiny = dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'e', -0.9, 0);
ok('a crop never collapses', tiny.w >= 0.04);
eq('resize by width keeps the shape', resizeTo(4000, 3000, { width: 2000 }), [2000, 1500]);
eq('resize by percent', resizeTo(4000, 3000, { percent: 25 }), [1000, 750]);
eq('formats', [outputFormat('same', 'JPG'), outputFormat('same', 'gif'), outputFormat('same', 'avif'), outputFormat('webp', 'png')],
  [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);

// ---- the document look ----
{
  const { documentLook } = await import('../src/media/imaging.js');
  // a page lit from the left: the paper goes from 110 (dark side) to 235 (bright side), with print (a third of the paper's brightness)
  const W = 240, H = 160;
  const data = new Uint8ClampedArray(W * H * 4);
  const paperAt = (x) => 110 + (125 * x) / (W - 1);
  const isPrint = (x, y) => y >= 30 && y < 130 && ((x >= 20 && x < 26) || (x >= 100 && x < 106) || (x >= 200 && x < 206));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = paperAt(x) * (isPrint(x, y) ? 0.33 : 1); const i = (y * W + x) * 4; data[i] = v; data[i + 1] = v; data[i + 2] = v * 0.97; data[i + 3] = 255; }
  const img = { width: W, height: H, data: new Uint8ClampedArray(data) };
  documentLook(img, { amount: 100 });
  const at = (x, y) => img.data[(y * W + x) * 4];
  eq('the paper is white on the dark side and on the bright side', [at(60, 10) >= 245, at(180, 10) >= 245, at(60, 150) >= 245], [true, true, true]);
  eq('the print is dark on the dark side, in the middle and on the bright side', [at(22, 80) <= 40, at(103, 80) <= 40, at(203, 80) <= 40], [true, true, true]);
  eq('black and white: red, green and blue agree', [img.data[(80 * W + 22) * 4] === img.data[(80 * W + 22) * 4 + 2], img.data[(10 * W + 60) * 4 + 3]], [true, 255]);
  const half = { width: W, height: H, data: new Uint8ClampedArray(data) };
  documentLook(half, { amount: 50 });
  eq('half the effect lands between the picture and the full effect', [half.data[(10 * W + 60) * 4] > data[(10 * W + 60) * 4] && half.data[(10 * W + 60) * 4] < 255, half.data[(80 * W + 22) * 4] > img.data[(80 * W + 22) * 4]], [true, true]);
  // colour: a blue pen on the same page stays blue
  const pen = new Uint8ClampedArray(data);
  for (let y = 30; y < 130; y++) for (let x = 100; x < 106; x++) { const i = (y * W + x) * 4; const v = paperAt(x); pen[i] = v * 0.2; pen[i + 1] = v * 0.3; pen[i + 2] = v * 0.9; }
  const col = { width: W, height: H, data: pen };
  documentLook(col, { amount: 100, colour: true });
  const ci = (80 * W + 103) * 4;
  eq('colour: the paper is white and the blue pen is still blue', [col.data[(10 * W + 60) * 4] >= 240, col.data[ci + 2] > col.data[ci] + 40], [true, true]);
  const none = { width: W, height: H, data: new Uint8ClampedArray(data) };
  documentLook(none, { amount: 0 });
  eq('amount 0 changes nothing, and a tiny picture is left alone', [none.data.every((v, i) => v === data[i]), documentLook({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(9) }, { amount: 100 }).data[0]], [true, 9]);
  const viaAdjust = { width: W, height: H, data: new Uint8ClampedArray(data) };
  applyAdjust(viaAdjust, { ...ADJUST_DEFAULTS, ...LOOKS.doc });
  eq('the Document look goes through the adjustments like the other looks', [viaAdjust.data[(10 * W + 60) * 4] >= 245, isIdentity({ ...ADJUST_DEFAULTS, scan: 100 }), isIdentity(ADJUST_DEFAULTS)], [true, false, true]);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
