// The search's folding: what counts as the same text when a word is typed and when it is looked for. Composed and decomposed accents, letters that
// have a plain spelling (ß, æ, ø, ł), ligatures, fullwidth letters, apostrophes and soft hyphens; and that a snippet still marks the right place
// in the original text when folding made it longer or shorter.

import { fold, matcher, visibleFiles } from '../src/model/files.js';
import { prepare, hitFor } from '../src/model/textsearch.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const finds = (query, text) => !!matcher(query)(text);
// both ways: the typed word finds the text, and the text typed as the query finds the word
const same = (a, b) => finds(a, b) && finds(b, a);

// ---- what already worked, and must keep working ----
eq('accents and capitals', fold('Müller ÉCOLE Straße'), 'muller ecole strasse');
eq('é as one character and as e plus an accent', [same('café', 'Café'), same('Café', 'café'), same('cafe', 'CAFÉ')], [true, true, true]);
eq('ß and ss, both ways', [same('hafenstrasse', 'Hafenstraße'), same('STRASSE', 'Straße'), same('Straße', 'strasse')], [true, true, true]);
eq('plain text is only lower-cased (the fast path)', [fold('Invoice 2026-10'), fold(''), fold(null), fold(undefined), fold(12)], ['invoice 2026-10', '', '', '', '12']);

// ---- what was missed: letters with a plain spelling ----
eq('l with a stroke: Łódź', [same('lodz', 'Łódź'), same('łódź', 'lodz')], [true, true]);
eq('o with a stroke: Søren, Ørsted, Østergade', [same('soren', 'Søren'), same('orsted', 'ØRSTED'), same('ostergade', 'Østergade')], [true, true, true]);
eq('ae and oe: Kær, cœur, Æble', [same('kaer', 'Kær'), same('coeur', 'cœur'), same('aeble', 'Æble'), same('Oe', 'Œ')], [true, true, true, true]);
eq('d with a stroke, eth, thorn, h and t with a stroke', [same('dorde', 'Đorđe'), same('hadis', 'Haðis'), same('thor', 'Þor'), same('hbar', 'ħbar'), same('tst', 'ŧst')], [true, true, true, true, true]);
eq('dotless i and dotted capital İ: Diyarbakır, İstanbul', [same('diyarbakir', 'Dıyarbakır'), same('istanbul', 'İstanbul')], [true, true]);
eq('capital sharp s', same('strasse', 'STRAẞE'), true);

// ---- what was missed: forms that only look different ----
eq('a ligature and its letters', [same('finance', 'ﬁnance'), same('office', 'oﬃce'), same('waffle', 'waﬄe')], [true, true, true]);
eq('fullwidth letters and digits', [same('file', 'Ｆｉｌｅ'), same('2026', '２０２６'), same('abc', 'ＡＢＣ')], [true, true, true]);
eq('superscripts and unit signs: m², 10³, ㎏', [same('m2', 'm²'), same('103', '10³'), same('kg', '㎏')], [true, true, true]);
eq('a curly apostrophe and a straight one', [same("don't", 'don’t'), same('don’t', "don't"), same("o'brien", 'O‘Brien')], [true, true, true]);
eq('a soft hyphen or zero-width space inside a word is not there', [same('information', 'infor­mation'), same('information', 'infor​mation'), same('information', '﻿information')], [true, true, true]);
eq('the Arabic presentation forms a PDF writes find the letters', same('مرحبا', 'ﻡﺮﺤﺒﺎ'), true);

// ---- and different words stay different ----
eq('not the same word', [finds('lodz', 'Lodge'), finds('soren', 'Sorin'), finds('kar', 'Kær'), finds('stras', 'Strasse') /* a part of a word still matches */, finds('strasse', 'Stra e')], [false, false, false, true, false]);
eq('the folded text of the plain letters is stable', ['straße', 'cœur', 'Łódź', 'ﬁnance'].map((s) => fold(fold(s)) === fold(s)), [true, true, true, true]);

// ---- in names, records and file text ----
const file = (name, extra = {}) => ({ name, notesText: '', group: 'other', tags: [], size: 1, uploaded: 1, ext: 'pdf', kind: 'pdf', key: name, ...extra });
const gallery = { records: [
  { rowId: 1, title: 'Søren Kær', fields: [], files: [file('Łódź-plan.pdf'), file('ﬁnance report.pdf')] },
  { rowId: 2, title: 'Müller', fields: [{ text: 'Dıyarbakır' }], files: [file('other.pdf')] },
] };
const found = (query, inside = null) => visibleFiles(gallery, { query, inside }).files.map((f) => f.name);
eq('file names', [found('lodz'), found('finance')], [['Łódź-plan.pdf'], ['ﬁnance report.pdf']]);
eq('a record title and a field find its files', [found('soren kaer'), found('diyarbakir')], [['Łódź-plan.pdf', 'ﬁnance report.pdf'], ['other.pdf']]);
const text = { 'other.pdf': prepare(['Die Rechnung für Straße und Ｂüro, Œuvres, don’t']) };
const inside = (f) => text[f.name] || null;
eq('text inside a file', [found('strasse buro', inside), found('oeuvres', inside), found("don't", inside), found('nothing here', inside)], [['other.pdf'], ['other.pdf'], ['other.pdf'], []]);

// ---- a snippet marks the right place in the original text ----
const mark = (page, word) => { const h = hitFor(prepare([page]), [fold(word)]); return h && h.parts[1]; };
eq('plain text', mark('The invoice is due in May', 'invoice'), 'invoice');
eq('after an accent written apart', mark('Stéphane and René came to the Café', 'cafe'), 'Café');
eq('after a ß, which folding lengthens', mark('Die Straße ist schön, die Straße ist lang', 'schon'), 'schön');
eq('after a ligature and an æ', mark('Ein ﬁnance Büro, Kær und Ærø und der Zentrum', 'zentrum'), 'Zentrum');
eq('a word that is itself spelled with a ligature or ß', [mark('Ein ﬁnance Büro', 'finance'), mark('Hafenstraße 12', 'strasse')], ['ﬁnance', 'straße']);
eq('a word with an accent written apart is marked with it', mark('Voila: école publique', 'ecole'), 'école');
eq('a longer and a shorter character on the same page used to cancel out in length and shift the mark', mark('Straße Paris école', 'paris'), 'Paris');
eq('a word that stops inside a letter folding wrote with two: the whole letter is marked', [mark('Les cœurs de la ville', 'coe'), mark('Les cœurs', 'o'), mark('Kær', 'a')], ['cœ', 'œ', 'æ']);
eq('after a character outside the basic plane', mark('😀 Ølbar und mehr', 'olbar'), 'Ølbar');
eq('a long page: the words around the mark come from the original', hitFor(prepare(['Ein langer Satz über die Straße von Łódź nach Wien und wieder zurück ins Büro']), ['lodz'], { context: 12 }).snippet, '…Straße von Łódź nach Wien u…');

console.log(`fold: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
