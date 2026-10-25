// The command palette (Ctrl+K): one box to find a command, a folder or a file. This picks and orders what to show; the items and what they do
// are made in main.js. Pure: tested in tests/palette.test.mjs.

import { fold } from './files.js';

export const PALETTE_GROUPS = ['commands', 'folders', 'files'];
/** How many of each group show at once (and, with nothing typed, only commands show). */
export const PALETTE_LIMITS = { commands: 9, folders: 6, files: 8 };

const PARTS = /[\s\-_.,:·()]+/;

/**
 * How well an item fits a query: 0 the label starts with what was typed, 1 every word starts a word of the label, 2 every word is inside
 * the label, 3 the words are found only in the extra text (a file's record, tags and note, a command's keywords); null when they are not found.
 */
export function fitOf(item, words) {
  const label = fold(item.label);
  if (!words.length) return 3;
  if (label.startsWith(words.join(' '))) return 0;
  const parts = label.split(PARTS).filter(Boolean);
  if (words.every((w) => parts.some((p) => p.startsWith(w)))) return 1;
  if (words.every((w) => label.includes(w))) return 2;
  const hay = label + ' ' + fold(item.hint || '') + ' ' + fold(item.words || '');
  return words.every((w) => hay.includes(w)) ? 3 : null;
}

/**
 * @param items [{group: 'commands'|'folders'|'files', label, hint?, words?, ...}]
 * @returns [{group, items}] the groups that have a match, the group with the best match first (ties: commands, folders, files), each group's
 *   best matches first (ties keep the order given), cut to the limits
 */
export function rankPalette(items, query, limits = PALETTE_LIMITS) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const by = new Map(PALETTE_GROUPS.map((g) => [g, []]));
  items.forEach((item, order) => {
    const fit = fitOf(item, words);
    if (fit == null || !by.has(item.group)) return;
    by.get(item.group).push({ item, fit, order });
  });
  const out = [];
  for (const g of PALETTE_GROUPS) {
    if (!words.length && g !== 'commands') continue;
    const list = by.get(g).sort((a, b) => a.fit - b.fit || a.order - b.order);
    if (!list.length) continue;
    out.push({ group: g, best: list[0].fit, items: list.slice(0, limits[g] ?? 8).map((x) => x.item) });
  }
  out.sort((a, b) => a.best - b.best || PALETTE_GROUPS.indexOf(a.group) - PALETTE_GROUPS.indexOf(b.group));
  return out.map(({ group, items: list }) => ({ group, items: list }));
}
