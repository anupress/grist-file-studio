// CSV and text files read and written back in their own dialect.

import { detectDialect, parseCsv, toCsv, squareUp, columnName, textDialect, toFileText } from '../src/media/csv.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const excelDe = '﻿Raum;Fläche;Notiz\r\nKüche;12,1;"Fenster; Süd"\r\nBad;6,2;"sagt ""ok"""\r\n';
const d = detectDialect(excelDe);
eq('German Excel: semicolons, CRLF, BOM, final newline', d, { bom: true, eol: '\r\n', trailing: true, sep: ';' });
const rows = parseCsv(excelDe, d.sep);
eq('parse with quotes and doubled quotes', rows, [['Raum', 'Fläche', 'Notiz'], ['Küche', '12,1', 'Fenster; Süd'], ['Bad', '6,2', 'sagt "ok"']]);
eq('written back byte for byte', toCsv(rows, d), excelDe);
const multi = 'a,b\n"line one\nline two",x\n';
eq('a line break inside quotes stays in the cell', parseCsv(multi), [['a', 'b'], ['line one\nline two', 'x']]);
eq('and survives the round trip', toCsv(parseCsv(multi), detectDialect(multi)), multi);
eq('no final newline is kept', toCsv(parseCsv('a,b\n1,2'), detectDialect('a,b\n1,2')), 'a,b\n1,2');
eq('tabs for TSV', detectDialect('a\tb\n1\t2\n', 'tsv').sep, '\t');
eq('commas in numbers do not fool the detection when quoted', detectDialect('"1,5";"2,5"\n"3,1";"4,0"\n').sep, ';');
eq('empty cells', parseCsv('a,,c\n,,\n'), [['a', '', 'c'], ['', '', '']]);
eq('square up', squareUp([['a'], ['b', 'c', 'd']]), [['a', '', ''], ['b', 'c', 'd']]);
eq('column names', [0, 25, 26, 27, 701, 702].map(columnName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
eq('quoting only when needed', toCsv([['plain', 'has,comma', ' lead', 'q"q']]), 'plain,"has,comma"," lead","q""q"\n');
const txt = 'line 1\r\nline 2\r\n';
const td = textDialect(txt);
eq('text dialect', td, { bom: false, eol: '\r\n', trailing: true });
eq('editor text back to the file’s line endings', toFileText('line 1\nline 2\n', td), txt);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
