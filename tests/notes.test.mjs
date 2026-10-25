// Tags and notes for files: reading the notes table, the actions that change it, and finding files by their tags.

import {
  NOTES_TABLE, createTable, cleanTag, tagsOf, tagsCell, rowsAreNotes, parseNotes, allTags, mergeTags, withoutTag, setNote, addTagTo, carryNotes, notesText, MAX_TAG, MAX_NOTE,
} from '../src/model/notes.js';
import { visibleFiles, visibleRecords } from '../src/model/files.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

eq('the action that makes the table', createTable()[0].slice(0, 2).concat(createTable()[0][2].map((c) => c.id)), ['AddTable', NOTES_TABLE, 'Ident', 'Name', 'Tags', 'Note']);
eq('a tag is tidied and cut', [cleanTag('  damp   patch '), cleanTag('x'.repeat(80)).length, cleanTag('   '), cleanTag(null)], ['damp patch', MAX_TAG, '', '']);
eq('tags from a cell: an encoded list, a plain list, nothing', [tagsOf(['L', 'a', 'b']), tagsOf(['c']), tagsOf(null), tagsOf('x'), tagsOf(['L'])], [['a', 'b'], ['c'], [], [], []]);
eq('tags to a cell', [tagsCell(['a', 'b']), tagsCell([])], [['L', 'a', 'b'], null]);
eq('rows that are the notes table', [rowsAreNotes([]), rowsAreNotes([{ id: 1, Ident: 'x', Tags: null, Note: '' }]), rowsAreNotes([{ id: 1, A: 1 }]), rowsAreNotes(null)], [true, true, false, false]);

const rows = [
  { id: 1, Ident: 'aaa', Name: 'kitchen.jpg', Tags: ['L', 'kitchen', 'before'], Note: 'From the balcony' },
  { id: 2, Ident: 'bbb', Name: 'damp.jpg', Tags: ['L', 'Damp'], Note: '' },
  { id: 3, Ident: 'aaa', Name: 'kitchen.jpg', Tags: ['L', 'Before', 'send'], Note: 'Again' },
  { id: 4, Ident: '', Name: 'nothing', Tags: null, Note: '' },
];
const notes = parseNotes(rows);
eq('one entry per file; a second row for the same file is folded in, a row with no ident is ignored', [notes.size, notes.get('aaa').tags, notes.get('aaa').note, notes.get('aaa').rowId, notes.has('')], [2, ['kitchen', 'before', 'send'], 'From the balcony\nAgain', 1, false]);
eq('all the tags, once each whatever the case, in order', allTags(parseNotes([...rows, { id: 5, Ident: 'ccc', Name: '', Tags: ['L', 'damp', 'Äpfel'], Note: '' }])), ['Äpfel', 'before', 'Damp', 'kitchen', 'send']);
eq('merging tags ignores case; removing does too', [mergeTags(['a', 'B'], ['b', 'c', 'A']), withoutTag(['a', 'B', 'c'], 'b')], [['a', 'B', 'c'], ['a', 'c']]);
eq('the words of a file\'s tags and note, for the search', [notesText(notes.get('bbb')), notesText(undefined)], ['Damp', '']);

// ---- changing ----
eq('a first tag adds a row', setNote(new Map(), { ident: 'zzz', name: 'new.jpg' }, { tags: ['Roof', ' roof '], note: ' a note ' }), [['AddRecord', NOTES_TABLE, null, { Ident: 'zzz', Name: 'new.jpg', Tags: ['L', 'Roof'], Note: 'a note' }]]);
eq('a changed one updates its row', setNote(notes, { ident: 'bbb', name: 'damp.jpg' }, { tags: ['Damp', 'urgent'], note: '' }), [['UpdateRecord', NOTES_TABLE, 2, { Name: 'damp.jpg', Tags: ['L', 'Damp', 'urgent'], Note: '' }]]);
eq('nothing changed: no action', setNote(notes, { ident: 'bbb', name: 'damp.jpg' }, { tags: ['Damp'], note: '' }), []);
eq('nothing left to keep: the row goes', setNote(notes, { ident: 'bbb', name: 'damp.jpg' }, { tags: [], note: '  ' }), [['RemoveRecord', NOTES_TABLE, 2]]);
eq('nothing to keep and no row: nothing', setNote(new Map(), { ident: 'q', name: 'q' }, { tags: [], note: '' }), []);
eq('a very long note is cut', setNote(new Map(), { ident: 'q', name: 'q' }, { tags: [], note: 'x'.repeat(5000) })[0][3].Note.length, MAX_NOTE);

const many = addTagTo(notes, [{ ident: 'aaa', name: 'kitchen.jpg' }, { ident: 'bbb', name: 'damp.jpg' }, { ident: 'ccc', name: 'c.jpg' }, { ident: 'ddd', name: 'd.jpg' }], 'Send');
eq('a tag for several files: the one that has it is left alone, one row is updated, the new ones are added together', [many.changed, many.actions.map((a) => a[0] + ':' + (Array.isArray(a[2]) ? a[2].length : a[2]))], [3, ['UpdateRecord:2', 'BulkAddRecord:2']]);
eq('the bulk add carries every column', many.actions[1][3], { Ident: ['ccc', 'ddd'], Name: ['c.jpg', 'd.jpg'], Tags: [['L', 'Send'], ['L', 'Send']], Note: ['', ''] });
eq('an empty tag does nothing', addTagTo(notes, [{ ident: 'q', name: 'q' }], '   '), { actions: [], changed: 0 });
eq('an edited file takes its tags along; not when the new hash has some already or is the same', carryNotes(notes, [['aaa', 'a2'], ['bbb', 'aaa'], ['aaa', 'aaa'], ['zzz', 'y']]), [['UpdateRecord', NOTES_TABLE, 1, { Ident: 'a2' }]]);

// ---- finding files by tags and notes ----
const file = (key, name, tags = [], note = '') => ({ key, name, group: 'image', ext: 'jpg', size: 1, tags, notesText: [...tags, note].join(' '), uploaded: 1 });
const gallery = { records: [
  { rowId: 1, title: 'Testgasse', fields: [], files: [file('a', 'one.jpg', ['kitchen', 'before'], 'from the balcony'), file('b', 'two.jpg', ['Damp']), file('c', 'three.jpg')] },
  { rowId: 2, title: 'Hafen', fields: [], files: [file('d', 'four.jpg', ['kitchen'])] },
] };
eq('search finds a tag and a word of a note', [visibleFiles(gallery, { query: 'damp' }).files.map((f) => f.key), visibleFiles(gallery, { query: 'balcony' }).files.map((f) => f.key)], [['b'], ['a']]);
eq('the tag filter, ignoring case, across records', [visibleFiles(gallery, { tag: 'Kitchen' }).files.map((f) => f.key), visibleFiles(gallery, { tag: 'damp' }).files.map((f) => f.key), visibleFiles(gallery, { tag: 'none' }).files.length], [['a', 'd'], ['b'], 0]);
eq('tag and search together', visibleFiles(gallery, { tag: 'kitchen', query: 'four' }).files.map((f) => f.key), ['d']);
eq('a record is found by its files\' notes in the cards', visibleRecords(gallery, { query: 'balcony' }).map((r) => r.rowId), [1]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
