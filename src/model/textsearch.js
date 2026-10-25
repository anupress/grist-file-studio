// Searching inside files: what the index keeps for a file, and where the words of a query are found in it.
//
// An entry is the file's text split into pages (a PDF's pages; one page for anything else), folded the way the search
// folds (lower case, no accents) so "Müller" finds "muller" and "MULLER". Pure functions: the reading of the files
// and the keeping of the text are elsewhere (media/textindex.js).

import { fold } from './files.js';

export { fold };
export const PAGE_BREAK = '\f';

/** pages: the text of each page -> an entry ready to search. */
export function prepare(pages) {
  const list = pages.map((p) => String(p || ''));
  const all = list.map(fold).join(PAGE_BREAK);
  // The folded pages are cut out of `all` only for the files that match: a thousand documents keep two copies of their
  // text in memory (the original, for snippets, and the folded whole, for matching), not three.
  return { pages: list, all, get folded() { const f = all.split(PAGE_BREAK); Object.defineProperty(this, 'folded', { value: f }); return f; } };
}

/**
 * Where the query's words are in an entry: the pages holding the most of them, and a snippet of the first.
 * Returns null when none of the words is in the file.
 * parts is the snippet cut into [before the word, the word, after it], so a screen can mark the word.
 * @returns {{words: number, pages: number[], paged: boolean, snippet: string, parts: string[]} | null}  pages are 1-based, at most 6
 */
export function hitFor(entry, words, { context = 44 } = {}) {
  if (!entry || !words.length) return null;
  const present = words.filter((w) => entry.all.includes(w));
  if (!present.length) return null;
  const score = entry.folded.map((f) => present.reduce((n, w) => n + (f.includes(w) ? 1 : 0), 0));
  const best = Math.max(...score);
  const pages = [];
  score.forEach((s, i) => { if (s === best && pages.length < 6) pages.push(i + 1); });
  const pi = pages[0] - 1;
  const f = entry.folded[pi], orig = entry.pages[pi];
  const word = present.find((w) => f.includes(w));
  const at = f.indexOf(word);
  const src = orig.length === f.length ? orig : f;    // folding can change a length: then the plain text is shown
  const from = Math.max(0, at - context), to = Math.min(src.length, at + word.length + context);
  const flat = (s) => s.replace(/\s+/g, ' ');
  const parts = [
    (from > 0 ? '…' : '') + flat(src.slice(from, at)).trimStart(),
    src.slice(at, at + word.length),
    flat(src.slice(at + word.length, to)).trimEnd() + (to < src.length ? '…' : ''),
  ];
  return { words: present.length, pages, paged: entry.pages.length > 1, snippet: parts.join(''), parts };
}

/** The same hit with at most n characters either side of the word: what fits on a small tile. */
export function shorten(hit, n = 18) {
  const [before, word, after] = hit.parts;
  const b = before.replace(/^…/, ''), a = after.replace(/…$/, '');
  const head = b.length > n ? '…' + b.slice(-n).trimStart() : before;
  const tail = a.length > n ? a.slice(0, n).trimEnd() + '…' : after;
  return [head, word, tail];
}
