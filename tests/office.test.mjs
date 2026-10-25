// Reading Word, Excel and PowerPoint files for the viewer: the XML reader, the document model, number formats and dates.

import { parseXml, rootOf, child, children, attr, descendants, allText } from '../src/media/xml.js';
import { readZip } from '../src/media/unzip.js';
import { makeZip } from '../src/media/zip.js';
import { readDocx, headingLevel, formatCounter } from '../src/media/docxread.js';
import { readXlsx, refOf, colName, isDateFormat, serialToDate, formatNumber, formatDate } from '../src/media/xlsxread.js';
import { readPptx } from '../src/media/pptxread.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };
const ok = (n, v) => eq(n, !!v, true);

// ---- the XML reader ----
const doc = parseXml('﻿<?xml version="1.0"?><!-- c --><a:r x="1" y=\'two &amp; three\'><b:t>Fish &amp; Chips &#233;&#x20AC;</b:t><c/><d><![CDATA[<raw & text>]]></d>tail</a:r>');
const r = rootOf(doc);
eq('the document element, its name and attributes (both quote styles, entities in values)', [r.name, r.attrs], ['a:r', { x: '1', y: 'two & three' }]);
eq('text with entities and numeric references', child(r, 'b:t').text, 'Fish & Chips é€');
eq('a self-closing element has no children', [child(r, 'c').kids.length, child(r, 'c').text], [0, '']);
eq('CDATA is text as it is', child(r, 'd').text, '<raw & text>');
eq('text directly in an element', r.text, 'tail');
eq('descendants and allText', [descendants(r, 'c').length, allText(r)], [1, 'tailFish & Chips é€<raw & text>']);
const evil = parseXml('<!DOCTYPE x [<!ENTITY boom "BOOM"><!ENTITY file SYSTEM "file:///etc/passwd">]><x>&boom; &file;</x>');
eq('a DOCTYPE is skipped and its entities are not expanded', rootOf(evil).text, '&boom; &file;');
eq('a stray < is text, a wrong closing tag does not break the tree', [rootOf(parseXml('<a>1 < 2<b>x</c>y</b>z</a>')).text, rootOf(parseXml('<a><b>x</c>y</b>z</a>')).kids.length], ['1 < 2z', 1]);
eq('a long document can be cut short', parseXml('<a>' + '<b/>'.repeat(50) + '</a>', { maxNodes: 10 }).truncated, true);
eq('children, attr, child on nothing', [children(r, 'b:t').length, attr(r, 'x'), child(null, 'z'), children(null, 'z'), attr(null, 'z')], [1, '1', null, [], undefined]);

// ---- zips by hand ----
const zipOf = async (files) => readZip(await makeZip(Object.entries(files).map(([path, text]) => ({ path, blob: new Blob([text]) }))));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="x" xmlns:a="y"';
const docx = await zipOf({
  'word/document.xml': `<w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Kaufvertrag</w:t></w:r></w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Fett </w:t></w:r><w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t>kursiv</w:t></w:r><w:r><w:t xml:space="preserve"> normal</w:t></w:r><w:r><w:br/><w:t>zweite Zeile</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Erster</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Zweiter</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Unterpunkt</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Punkt</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Titel</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:hyperlink r:id="rId9"><w:r><w:t>Link</w:t></w:r></w:hyperlink><w:hyperlink r:id="rId8"><w:r><w:t>Bad</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:ins><w:r><w:t>neu</w:t></w:r></w:ins><w:del><w:r><w:delText>alt</w:delText></w:r></w:del></w:p>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
  </w:body></w:document>`,
  'word/styles.xml': `<w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Titel"><w:name w:val="Title"/></w:style><w:style w:styleId="Kopf2" w:type="paragraph"><w:name w:val="Kapitel"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`,
  'word/numbering.xml': `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  'word/_rels/document.xml.rels': `<Relationships><Relationship Id="rId9" Type="x" Target="https://example.org/a" TargetMode="External"/><Relationship Id="rId8" Type="x" Target="javascript:alert(1)" TargetMode="External"/><Relationship Id="rId5" Type="x" Target="media/image1.png"/></Relationships>`,
});
const d = await readDocx(docx);
const text = (b) => b.runs.map((x) => (x.br ? '\n' : x.t ?? '')).join('');
eq('a heading takes its level from the style name', [d.blocks[0].heading, text(d.blocks[0])], [1, 'Kaufvertrag']);
eq('runs: bold, italic with underline, plain, and a line break', d.blocks[1].runs.map((x) => (x.br ? 'br' : `${x.t}|${x.b ? 'b' : ''}${x.i ? 'i' : ''}${x.u ? 'u' : ''}`)), ['Fett |b', 'kursiv|iu', ' normal|', 'br', 'zweite Zeile|']);
eq('alignment', d.blocks[1].align, 'center');
eq('numbered list markers, and the sub-level starting again', [2, 3, 4].map((i) => d.blocks[i].marker), ['1.', '2.', 'a)']);
eq('a bullet is a bullet whatever symbol font char Word wrote', [d.blocks[5].marker, d.blocks[5].level], ['•', 0]);
const tbl = d.blocks[6];
eq('a table: a cell that spans two columns, one that spans two rows', [tbl.rows.length, tbl.rows[0].cells[0].span, tbl.rows[1].cells[0].rowSpan, tbl.rows[2].cells.length], [3, 2, 2, 1]);
eq('the text in cells', tbl.rows[1].cells.map((c) => text(c.blocks[0])), ['A', 'B']);
eq('an http link keeps its address, a javascript: one loses it', d.blocks[7].runs.map((x) => [x.t, x.href || null]), [['Link', 'https://example.org/a'], ['Bad', null]]);
eq('tracked changes: the insertion is shown, the deletion is not', text(d.blocks[8]), 'neu');
eq('a picture: the file inside the zip and its size in pixels', d.blocks[9].runs[0].img, { path: 'word/media/image1.png', w: 200, h: 100 });
eq('a block limit cuts a long document', (await readDocx(docx, { maxBlocks: 3 })).truncated, true);
eq('heading levels by name, outline level and the style it is based on', [headingLevel(new Map([['x', { name: 'Title', based: null, outline: null }]]), 'x'), headingLevel(new Map([['k', { name: 'Kapitel', based: null, outline: 1 }]]), 'k'), headingLevel(new Map(), 'Heading3'), headingLevel(new Map(), 'Normal')], [0, 2, 3, null]);
eq('counters in other styles', [formatCounter(27, 'lowerLetter'), formatCounter(4, 'upperRoman'), formatCounter(9, 'lowerRoman'), formatCounter(7, 'decimalZero')], ['aa', 'IV', 'ix', '07']);

// ---- numbers and dates ----
eq('cell references', [refOf('C12'), refOf('$AA$3'), refOf('x')], [{ col: 2, row: 11 }, { col: 26, row: 2 }, null]);
eq('column names', [colName(0), colName(25), colName(26), colName(701), colName(702)], ['A', 'Z', 'AA', 'ZZ', 'AAA']);
eq('which formats are dates', [isDateFormat(14, null), isDateFormat(164, 'dd/mm/yyyy'), isDateFormat(0, 'General'), isDateFormat(165, '0.00 "m"'), isDateFormat(166, 'h:mm'), isDateFormat(167, '[$-407]d. mmmm yyyy'), isDateFormat(168, '#,##0.00')], [true, true, false, false, true, true, false]);
eq('date serials', [serialToDate(1).toISOString().slice(0, 10), serialToDate(59).toISOString().slice(0, 10), serialToDate(61).toISOString().slice(0, 10), serialToDate(45000).toISOString().slice(0, 10), serialToDate(0, true).toISOString().slice(0, 10)], ['1900-01-01', '1900-02-28', '1900-03-01', '2023-03-15', '1904-01-01']);
eq('numbers: general drops float noise', [formatNumber(0.1 + 0.2, 'General', 'en-US'), formatNumber(48213.7, null, 'en-US'), formatNumber(42, 'General', 'de-DE'), formatNumber(1234.5, 'General', 'de-DE')], ['0.3', '48213.7', '42', '1234,5']);
eq('numbers: decimals and thousands in two languages', [formatNumber(1234.5, '#,##0.00', 'en-US'), formatNumber(1234.5, '#,##0.00', 'de-DE'), formatNumber(7, '0.00', 'en-US'), formatNumber(1234567, '0', 'en-US')], ['1,234.50', '1.234,50', '7.00', '1234567']);
eq('numbers: percent and scientific and a currency sign', [formatNumber(0.256, '0.0%', 'en-US'), formatNumber(0.256, '0%', 'de-DE').replace(/\s/g, ' '), formatNumber(12345, '0.00E+00', 'en-US'), formatNumber(9.5, '"€" #,##0.00', 'en-US'), formatNumber(9.5, '#,##0.00 "€"', 'de-DE')], ['25.6%', '26 %', '1.23E+4', '€ 9.50', '9,50 €']);
eq('dates in a format, in two languages', [formatDate(45000, 'dd/mm/yyyy', 'en-US'), formatDate(45000, 'dd/mm/yyyy', 'de-DE'), formatDate(45000.75, 'h:mm', 'en-US').replace(/\s/g, ' '), formatDate(45000.75, 'dd/mm/yyyy hh:mm', 'en-US').includes('2023')], ['Mar 15, 2023', '15.03.2023', '6:00 PM', true]);

// ---- a workbook ----
const X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const xlsx = await zipOf({
  'xl/workbook.xml': `<workbook ${X}><workbookPr/><sheets><sheet name="Miete" sheetId="1" r:id="rId1"/><sheet name="Verborgen" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Zwei" sheetId="3" r:id="rId3"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="/xl/worksheets/sheet3.xml"/></Relationships>`,
  'xl/sharedStrings.xml': `<sst ${X}><si><t>Raum</t></si><si><r><t>Fläche</t></r><r><t> (m²)</t></r></si><si><t>Küche</t></si></sst>`,
  'xl/styles.xml': `<styleSheet ${X}><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;€&quot; #,##0.00"/></numFmts><cellXfs count="6"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="4"/><xf numFmtId="9"/><xf numFmtId="165"/></cellXfs></styleSheet>`,
  'xl/worksheets/sheet1.xml': `<worksheet ${X}><cols><col min="1" max="2" width="14.5" customWidth="1"/></cols><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>inline</t></is></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="3"><v>14.5</v></c><c r="C2" s="1"><v>45000</v></c><c r="D2" s="4"><v>0.256</v></c><c r="E2" t="b"><v>1</v></c><c r="F2" t="str"><f>A2&amp;"!"</f><v>Küche!</v></c><c r="G2" s="5"><v>1234.5</v></c><c r="H2" t="e"><v>#DIV/0!</v></c></row>
    <row r="4"><c r="A4"><v>7</v></c></row><row r="2000"><c r="A2000"><v>1</v></c></row>
  </sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>`,
  'xl/worksheets/sheet2.xml': `<worksheet ${X}><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`,
  'xl/worksheets/sheet3.xml': `<worksheet ${X}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
});
const wb = await readXlsx(xlsx, { locale: 'en-US' });
eq('the visible sheets by name', wb.sheets.map((s) => s.name), ['Miete', 'Zwei']);
const s1 = wb.sheets[0];
eq('shared strings, rich text joined, inline strings', [s1.rows[0][0].text, s1.rows[0][1].text, s1.rows[0][3].text], ['Raum', 'Fläche (m²)', 'inline']);
eq('a gap in a row stays a gap', [s1.rows[0][2], s1.rows[0].length], [undefined, 4]);
eq('numbers in their formats, a date, a percentage, a boolean', [s1.rows[1][1].text, s1.rows[1][2].text, s1.rows[1][3].text, s1.rows[1][4].text], ['14.50', 'Mar 15, 2023', '26%', 'TRUE']);
eq('a formula shows its stored result, a currency format its sign, an error its code', [s1.rows[1][5].text, s1.rows[1][6].text, s1.rows[1][7].text, s1.rows[1][7].kind], ['Küche!', '€ 1,234.50', '#DIV/0!', 'error']);
eq('cell kinds: text, number, boolean', [s1.rows[0][0].kind, s1.rows[1][1].kind, s1.rows[1][4].kind], ['text', 'number', 'bool']);
eq('column widths and merged cells', [s1.widths.slice(0, 3), s1.merges], [[14.5, 14.5], [{ r0: 0, c0: 0, r1: 0, c1: 1 }]]);
eq('a row past the limit is cut and said so', [s1.truncated, s1.rows.length], [true, 4]);
eq('and the empty row between is there', [s1.rows[2].length, s1.rows[3][0].text], [0, '7']);
eq('the second sheet', wb.sheets[1].rows[0][0].text, 'Raum');
eq('the same workbook in German', (await readXlsx(xlsx, { locale: 'de-DE' })).sheets[0].rows[1].slice(1, 4).map((c) => c.text.replace(/\s/g, ' ')), ['14,50', '15.03.2023', '26 %']);

// ---- a presentation ----
const A = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';
const pptx = await zipOf({
  'ppt/presentation.xml': `<p:presentation ${A}><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
  'ppt/slides/slide2.xml': `<p:sld ${A}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Zweite Folie</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  'ppt/slides/slide10.xml': `<p:sld ${A}><p:cSld><p:spTree><p:pic/></p:spTree></p:cSld></p:sld>`,
  'ppt/slides/slide1.xml': `<p:sld ${A}><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Übergabe</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="subTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Testgasse 7</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Erster Punkt</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>Unterpunkt</a:t></a:r></a:p><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>ohne Punkt</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Textfeld</a:t></a:r><a:br/><a:r><a:t>zweite Zeile</a:t></a:r></a:p></p:txBody></p:sp>
    <p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Raum</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>m²</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>
    <p:pic/><p:pic/></p:spTree></p:cSld></p:sld>`,
});
const pp = await readPptx(pptx);
eq('slides in their numeric order, the shape of the slide', [pp.slides.map((s) => s.title), Math.round(pp.ratio * 100) / 100], [['Übergabe', 'Zweite Folie', ''], 1.33]);
const sl = pp.slides[0];
eq('title, subtitle and the text in order, with levels and bullets', [sl.subtitle, sl.items.map((i) => `${i.text}|${i.level}|${i.bullet ? 'b' : ''}`)], ['Testgasse 7', ['Erster Punkt|0|b', 'Unterpunkt|1|b', 'ohne Punkt|0|', 'Textfeld\nzweite Zeile|0|']]);
eq('a table and the pictures counted', [sl.tables, sl.pictures, pp.slides[2].pictures], [[[['Raum', 'm²']]], 2, 1]);
eq('a slide limit', (await readPptx(pptx, { maxSlides: 2 })).truncated, true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
