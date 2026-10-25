// Tags and a note for a file, kept in a table of the document (so they are shared, searchable in Grist and covered by its Undo, history and
// access rules) and tied to the file's content hash: the same photo in two records has the same tags, and an edited file takes them along.
//
// The table is called File_Studio_notes and has four columns: Ident (the content hash), Name (the file's name when it was last tagged, for
// people reading the table), Tags (a choice list) and Note (text). File Studio makes it only when someone asks for the first tag.
// Pure: this file builds and reads Grist data, it never calls Grist.

export const NOTES_TABLE = 'File_Studio_notes';
export const NOTES_COLUMNS = [
  { id: 'Ident', type: 'Text', isFormula: false },
  { id: 'Name', type: 'Text', isFormula: false },
  { id: 'Tags', type: 'ChoiceList', isFormula: false },
  { id: 'Note', type: 'Text', isFormula: false },
];
export const MAX_TAG = 40;
export const MAX_NOTE = 2000;

/** The action that makes the table. */
export const createTable = () => [['AddTable', NOTES_TABLE, NOTES_COLUMNS]];

/** A tag as it will be stored: spaces tidied, no longer than MAX_TAG, no empty one. */
export const cleanTag = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG);

/** The tags of a cell as an array: ['L', 'a', 'b'] (how Grist sends a choice list), a plain array, or nothing. */
export const tagsOf = (cell) => (Array.isArray(cell) ? (cell[0] === 'L' ? cell.slice(1) : cell).map(String).filter(Boolean) : []);
/** An array of tags as a choice list cell (null when there are none). */
export const tagsCell = (tags) => (tags.length ? ['L', ...tags] : null);

/** Do these rows (from fetchRows) look like the notes table's? An empty table does; a table without the columns does not. */
export const rowsAreNotes = (rows) => Array.isArray(rows) && (!rows.length || ['Ident', 'Tags', 'Note'].every((c) => c in rows[0]));

/** @returns Map(ident -> {rowId, name, tags: string[], note}) from the notes table's rows */
export function parseNotes(rows) {
  const out = new Map();
  if (!rowsAreNotes(rows)) return out;
  for (const row of rows) {
    const ident = String(row.Ident ?? '');
    if (!ident) continue;
    const entry = { rowId: row.id, name: String(row.Name ?? ''), tags: tagsOf(row.Tags), note: String(row.Note ?? '') };
    // two rows for one file (made by hand): the first keeps its place, the second's tags and note are added to it
    const had = out.get(ident);
    if (had) { had.tags = mergeTags(had.tags, entry.tags); if (entry.note && !had.note.includes(entry.note)) had.note = (had.note ? had.note + '\n' : '') + entry.note; } else out.set(ident, entry);
  }
  return out;
}

/** Every tag in use, case-insensitively unique, sorted. */
export function allTags(notes) {
  const seen = new Map();
  for (const n of notes.values()) for (const tag of n.tags) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** a plus the tags of b that a does not have (ignoring case), in order. */
export function mergeTags(a, b) {
  const have = new Set(a.map((x) => x.toLowerCase()));
  const out = a.slice();
  for (const tag of b) if (!have.has(tag.toLowerCase())) { have.add(tag.toLowerCase()); out.push(tag); }
  return out;
}

/** Take a tag out (ignoring case). */
export const withoutTag = (tags, tag) => tags.filter((x) => x.toLowerCase() !== tag.toLowerCase());

/**
 * The actions that set one file's tags and note. Nothing left to keep (no tags, no note) removes its row.
 * @param file {ident, name}
 * @param value {tags, note}
 */
export function setNote(notes, file, value) {
  const tags = mergeTags([], value.tags.map(cleanTag).filter(Boolean));
  const note = String(value.note ?? '').trim().slice(0, MAX_NOTE);
  const had = notes.get(file.ident);
  if (!tags.length && !note) return had ? [['RemoveRecord', NOTES_TABLE, had.rowId]] : [];
  const fields = { Name: file.name, Tags: tagsCell(tags), Note: note };
  if (had) {
    if (sameTags(had.tags, tags) && had.note === note) return [];
    return [['UpdateRecord', NOTES_TABLE, had.rowId, fields]];
  }
  return [['AddRecord', NOTES_TABLE, null, { Ident: file.ident, ...fields }]];
}

const sameTags = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Add a tag to several files at once. files: [{ident, name}] (one per content). Files that have it already are left alone.
 * @returns {{actions, changed: number}}
 */
export function addTagTo(notes, files, tag) {
  const clean = cleanTag(tag);
  const actions = [];
  let changed = 0;
  if (!clean) return { actions, changed };
  const fresh = [];
  for (const f of files) {
    const had = notes.get(f.ident);
    if (had) {
      const tags = mergeTags(had.tags, [clean]);
      if (tags.length === had.tags.length) continue;
      actions.push(['UpdateRecord', NOTES_TABLE, had.rowId, { Name: f.name, Tags: tagsCell(tags) }]);
      changed++;
    } else fresh.push(f);
  }
  if (fresh.length) {
    actions.push(['BulkAddRecord', NOTES_TABLE, fresh.map(() => null), {
      Ident: fresh.map((f) => f.ident), Name: fresh.map((f) => f.name), Tags: fresh.map(() => tagsCell([clean])), Note: fresh.map(() => ''),
    }]);
    changed += fresh.length;
  }
  return { actions, changed };
}

/** When a file is replaced by an edited one (a new content hash), its tags and note go with it. pairs: [[oldIdent, newIdent]] */
export function carryNotes(notes, pairs) {
  const actions = [];
  const taken = new Set();
  for (const [from, to] of pairs) {
    const had = notes.get(from);
    if (!had || !to || from === to || notes.has(to) || taken.has(to)) continue;
    taken.add(to);
    actions.push(['UpdateRecord', NOTES_TABLE, had.rowId, { Ident: to }]);
  }
  return actions;
}

/** The words of a file's tags and note, for the search. */
export const notesText = (n) => (n ? [...n.tags, n.note].filter(Boolean).join(' ') : '');
