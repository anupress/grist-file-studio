// Name patterns, safe and unique names, the edit actions, and zip files read back byte by byte.

import { safeName, fillPattern, placeholders, unknownPlaceholders, uniqueNamer, exportPaths } from '../src/model/names.js';
import { addFiles, removeFile, removeFiles, moveFile, newRecords, renameFiles, sharedValue, cellOf } from '../src/model/edits.js';
import { crc32, makeZip, dosDateTime, manifestCsv } from '../src/media/zip.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

// ---- names ----
eq('safe names', [safeName('a/b:c*?.pdf'), safeName('  trailing dots... '), safeName('CON'), safeName('x'.repeat(200)).length, safeName('Straße – Übergabe')],
  ['a-b-c--.pdf', 'trailing dots', '_CON', 120, 'Straße – Übergabe']);
eq('placeholders', placeholders('{Invoice} {Client name}-{n}'), ['Invoice', 'Client name', 'n']);
const columns = [{ id: 'Invoice', label: 'Invoice' }, { id: 'Client_name', label: 'Client name' }];
const file = { name: 'IMG_0042.JPG', ext: 'jpg', rowId: 7, attId: 3, uploaded: Date.UTC(2026, 9, 25, 12) };
const text = (c) => ({ Invoice: 'R-2026-001', Client_name: 'Müller GmbH' })[c];
eq('fill a pattern', fillPattern('{Invoice} {Client name} {nn}', { file, n: 3, columns, text }), 'R-2026-001 Müller GmbH 03');
eq('built-ins', fillPattern('{file}|{n}|{nnn}|{N}|{id}|{record}|{date}', { file, n: 2, N: 40, columns, text, record: { rowId: 7, title: 'Haus' } }), 'IMG_0042|2|002|40|7|Haus|2026-10-25');
eq('an unknown placeholder is left as written', fillPattern('{Nope}-{n}', { file, n: 1, columns, text }), '{Nope}-1');
eq('unknown placeholders are reported', unknownPlaceholders('{Invoice} {Nope} {n} {client NAME}', columns), ['Nope']);
const u = uniqueNamer();
eq('unique within a folder, case-insensitively', [u('', 'Plan', 'pdf'), u('', 'plan', 'PDF'), u('', 'Plan', 'pdf'), u('A', 'Plan', 'pdf')], ['Plan.pdf', 'plan (2).PDF', 'Plan (3).pdf', 'Plan.pdf']);
const items = [
  { file: { ...file, attId: 1 }, record: { rowId: 7, title: 'Haus A' }, n: 1 },
  { file: { ...file, attId: 2 }, record: { rowId: 7, title: 'Haus A' }, n: 2 },
  { file: { ...file, attId: 3, name: 'plan.pdf', ext: 'pdf', rowId: 8 }, record: { rowId: 8, title: 'Haus A' }, n: 1 },
];
eq('export paths with folders', exportPaths(items, { pattern: '{record} {n}', folders: true, columns }).map((x) => x.path),
  ['Haus A/Haus A 1.jpg', 'Haus A/Haus A 2.jpg', 'Haus A (2)/Haus A 1.pdf']);
eq('export paths flat keep names unique', exportPaths(items, { pattern: '{file}', columns }).map((x) => x.path), ['IMG_0042.jpg', 'IMG_0042 (2).jpg', 'plan.pdf']);
eq('an empty pattern result falls back to the file name', exportPaths([items[0]], { pattern: '{Client_name}', columns, textOf: () => '' }).map((x) => x.path), ['IMG_0042.jpg']);

// ---- edits ----
eq('cell of ids', [cellOf([1, 2]), cellOf([])], [['L', 1, 2], null]);
eq('add files after the ones there', addFiles('Sites', 4, 'Photos', ['L', 1], [7, 8]), [['UpdateRecord', 'Sites', 4, { Photos: ['L', 1, 7, 8] }]]);
eq('add to an empty cell', addFiles('Sites', 4, 'Photos', null, [7]), [['UpdateRecord', 'Sites', 4, { Photos: ['L', 7] }]]);
const f2 = { rowId: 4, col: 'Photos', index: 1, attId: 2 };
eq('remove by place', removeFile('Sites', f2, ['L', 1, 2, 3]), [['UpdateRecord', 'Sites', 4, { Photos: ['L', 1, 3] }]]);
eq('remove when the cell moved on', removeFile('Sites', f2, ['L', 2, 3]), [['UpdateRecord', 'Sites', 4, { Photos: ['L', 3] }]]);
eq('remove the last file empties the cell', removeFile('Sites', { ...f2, index: 0 }, ['L', 2]), [['UpdateRecord', 'Sites', 4, { Photos: null }]]);
eq('remove a file that is gone does nothing', removeFile('Sites', f2, ['L', 5]), null);
eq('remove several, one bundle per cell', removeFiles('Sites', [{ rowId: 4, col: 'Photos', index: 0, attId: 1 }, { rowId: 4, col: 'Photos', index: 2, attId: 3 }, { rowId: 5, col: 'Docs', index: 0, attId: 9 }],
  (r, c) => ({ '4Photos': ['L', 1, 2, 3], '5Docs': ['L', 9, 10] })[r + c]),
  [['UpdateRecord', 'Sites', 4, { Photos: ['L', 2] }], ['UpdateRecord', 'Sites', 5, { Docs: ['L', 10] }]]);
eq('make cover', moveFile('Sites', { ...f2, index: 2, attId: 3 }, ['L', 1, 2, 3], 0), [['UpdateRecord', 'Sites', 4, { Photos: ['L', 3, 1, 2] }]]);
eq('move to the same place does nothing', moveFile('Sites', f2, ['L', 1, 2, 3], 1), null);
const titleCol = { id: 'Name', kind: 'Text', isFormula: false };
eq('new records from files', newRecords('Sites', [{ id: 7, name: 'Front door.jpg' }, { id: 8, name: 'plan.final.pdf' }], { titleCol, filesCol: 'Photos', prefill: { col: 'Place', value: 3 } }),
  [['BulkAddRecord', 'Sites', [null, null], { Photos: [['L', 7], ['L', 8]], Name: ['Front door', 'plan.final'], Place: [3, 3] }]]);
eq('no title when the title column is a formula', newRecords('Sites', [{ id: 7, name: 'a.jpg' }], { titleCol: { ...titleCol, isFormula: true }, filesCol: 'Photos' }),
  [['BulkAddRecord', 'Sites', [null], { Photos: [['L', 7]] }]]);
eq('rename one', renameFiles([{ attId: 3, name: ' New.jpg ' }]), [['UpdateRecord', '_grist_Attachments', 3, { fileName: 'New.jpg' }]]);
eq('rename many', renameFiles([{ attId: 3, name: 'a.jpg' }, { attId: 4, name: 'b.jpg' }, { attId: 5, name: '' }]), [['BulkUpdateRecord', '_grist_Attachments', [3, 4], { fileName: ['a.jpg', 'b.jpg'] }]]);
eq('shared link value', [sharedValue([{ P: ['R', 'Places', 3] }, { P: ['R', 'Places', 3] }], 'P'), sharedValue([{ P: 1 }, { P: 2 }], 'P'), sharedValue([], 'P')], [3, null, null]);

// ---- zip ----
eq('crc32 of "123456789"', crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');
const enc = new TextEncoder();
eq('crc32 in chunks equals in one go', crc32(enc.encode('6789'), crc32(enc.encode('12345'))).toString(16), 'cbf43926');
const dt = dosDateTime(new Date(2026, 9, 25, 14, 30, 58));
eq('dos date and time', [dt.date >> 9, (dt.date >> 5) & 15, dt.date & 31, dt.time >> 11, (dt.time >> 5) & 63, (dt.time & 31) * 2], [46, 10, 25, 14, 30, 58]);

const zip = await makeZip([
  { path: 'Haus A/Übergabe 1.txt', blob: new Blob(['hello straße']) },
  { path: 'plan.bin', blob: new Blob([new Uint8Array([0, 1, 2, 255])]) },
  { path: 'empty.txt', blob: new Blob([]) },
]);
const buf = new Uint8Array(await zip.arrayBuffer());
const dv = new DataView(buf.buffer);
// Read it back the way an unzipper does: from the end of central directory record.
const eocd = buf.length - 22;
eq('ends with the end-of-directory record', dv.getUint32(eocd, true), 0x06054b50);
const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
eq('entry count', count, 3);
const back = [];
for (let i = 0, p = cdOff; i < count; i++) {
  const nameLen = dv.getUint16(p + 28, true), size = dv.getUint32(p + 24, true), crc = dv.getUint32(p + 16, true), off = dv.getUint32(p + 42, true), flags = dv.getUint16(p + 8, true);
  const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen));
  const lNameLen = dv.getUint16(off + 26, true);
  const data = buf.slice(off + 30 + lNameLen, off + 30 + lNameLen + size);
  back.push({ name, size, crcOk: crc32(data) === crc, utf8: !!(flags & 0x800), sig: dv.getUint32(off, true) === 0x04034b50 });
  p += 46 + nameLen;
}
eq('entries read back', back, [
  { name: 'Haus A/Übergabe 1.txt', size: 13, crcOk: true, utf8: true, sig: true },
  { name: 'plan.bin', size: 4, crcOk: true, utf8: true, sig: true },
  { name: 'empty.txt', size: 0, crcOk: true, utf8: true, sig: true },
]);
eq('directory sits right before the end record', cdOff + cdSize, eocd);
eq('manifest csv quotes and BOM', manifestCsv([['a,b', 'say "hi"']], ['File', 'Note']), '﻿File,Note\r\n"a,b","say ""hi"""\r\n');

if (process.argv.includes('--write')) {
  const fs = await import('node:fs');
  fs.writeFileSync(process.argv[process.argv.indexOf('--write') + 1], buf);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
